/**
 * ========================================
 * offline.js
 * الوظيفة: الدفعة ١ من الأوفلاين — حالة الاتصال، الشريط/التنبيه للدكتور،
 *          و«الدفتر» المحلي المشفّر (IndexedDB + AES-GCM) مع محرّك رفع مرتّب.
 * الدوال/الكيانات الرئيسية: Offline.init / enqueue / flush / markConflict / resolveConflict
 * الاعتمادات: config.js (logError)، utils.js (toast, esc) — كلها اختيارية وقت النداء
 * آخر تعديل: 2026-11-04 — الدفعة ١
 * ========================================
 */
'use strict';

/* ============================================================
   قرارات صاحب المشروع (مسجّلة)
   ------------------------------------------------------------
   1) الدفتر على «جهاز المستخدم» فقط: لا نسخة سحابية ولا جهة ثالثة،
      والرفع يروح لمشروع Supabase المضبوط في supabaseConfig فقط.
   2) أي تعارض/فشل دائم → **تنبيه للدكتور يراجعه بيده**، مش قرار أوتوماتيك.
   3) موافقة صريحة على تخزين بيانات المرضى محلياً، بشرط: مشفّرة،
      مؤقتة، وعلى الجهاز فقط. لو التشفير مش متاح → لا نحفظ أي بيانات.
   ============================================================ */
const Offline = {
  isOnline: true,
  role: 'clinic',            // 'clinic' = جهاز العيادة | 'patient' = موبايل المريض
  pending: 0,
  conflicts: [],
  encryption: false,
  _key: null,
  _flushing: false,
  _panelOpen: false,
  replay: null, // الدفعة ٢ هتوصّل هنا مُرسِل الكتابات الحقيقي

  init() {
    Offline.isOnline = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
    Offline.encryption = !!(typeof crypto !== 'undefined' && crypto.subtle && crypto.getRandomValues);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => {
        Offline.isOnline = true;
        Offline.render();
        // أول ما النت يرجع: ارفع كل اللي اتسجّل، بالترتيب
        Offline.flush().catch(e => Offline.log(e, 'offline.flush.online'));
      });
      window.addEventListener('offline', () => { Offline.isOnline = false; Offline.render(); });
      Offline.registerSW();
    }
    Offline.bindUI();
    Offline.refreshCount().catch(e => Offline.log(e, 'offline.count'));
    Offline.render();
  },

  registerSW() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const go = () => {
      try {
        const p = navigator.serviceWorker.register('sw.js', { scope: './' });
        if (p && p.catch) p.catch(e => Offline.log(e, 'offline.sw'));
      } catch (e) { Offline.log(e, 'offline.sw'); }
    };
    if (typeof document !== 'undefined' && document.readyState === 'complete') go();
    else if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('load', go, { once: true });
  },

  // ---------- المخزن المحلي (IndexedDB فقط، على نفس الجهاز/نفس المتصفح) ----------
  // _openDB قابلة للاستبدال في الاختبارات بمخزن ذاكرة.
  _openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject({ code: 'offline_no_idb' }); return; }
      const req = indexedDB.open('clinic-offline-v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(idbWrap(req.result));
      req.onerror = () => reject(req.error);
    });
  },

  // مفتاح الجهاز: عشوائي 256 بت، غير قابل للتصدير، محفوظ على الجهاز فقط.
  async deviceKey() {
    if (Offline._key) return Offline._key;
    const db = await Offline._openDB();
    const row = await db.get('meta', 'deviceKey');
    if (row && row.value) { Offline._key = row.value; return row.value; }
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await db.put('meta', { k: 'deviceKey', value: key });
    Offline._key = key;
    return key;
  },

  // 🚫 أكواد الدخول والتوكنات والأسرار عمرها ما تدخل الدفتر
  assertSafe(payload) {
    const text = JSON.stringify(payload || {});
    if (/"(?:p_)?(?:code|token|password|passwd|secret|access_?code|patient_?code|anon_?key|api_?key|service_?role|authorization|bearer)"\s*:/i.test(text)) {
      throw { code: 'offline_forbidden_field', message: 'ممنوع تخزين أكواد الدخول أو التوكنات في الدفتر المحلي' };
    }
  },

  async enqueue(payload) {
    Offline.assertSafe(payload);
    if (!Offline.encryption) {
      throw { code: 'offline_crypto_missing', message: 'التشفير غير متاح على هذا الجهاز — لن نحفظ بيانات المرضى محلياً' };
    }
    const key = await Offline.deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
    const id = 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
    const db = await Offline._openDB();
    // ترتيب صارم ومتزايد: عمليتين في نفس الملي ثانية لازم يفضلوا بترتيب تسجيلهم،
    // وكمان بعد إعادة فتح الصفحة ما يحصلش تخطّي للعناصر القديمة.
    let seq = Date.now();
    for (const r of await db.getAll('queue')) {
      if (Number(r.seq) >= seq) seq = Number(r.seq) + 1;
    }
    const row = {
      id, seq, createdAt: new Date().toISOString(),
      requestId: (payload && payload.requestId) || id, // idempotency عند إعادة المحاولة
      iv: Array.from(iv), data: Array.from(new Uint8Array(buf))
    };
    await db.put('queue', row);
    await Offline.refreshCount();
    return id;
  },

  async all() {
    const db = await Offline._openDB();
    const rows = await db.getAll('queue');
    rows.sort((a, b) => (a.seq - b.seq) || String(a.id).localeCompare(String(b.id)));
    const key = await Offline.deviceKey();
    const out = [];
    for (const r of rows) {
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(r.iv) }, key, new Uint8Array(r.data));
        out.push({
          id: r.id, requestId: r.requestId, createdAt: r.createdAt,
          conflict: r.conflict || null, payload: JSON.parse(new TextDecoder().decode(plain))
        });
      } catch (_) {
        out.push({ id: r.id, requestId: r.requestId, createdAt: r.createdAt,
          conflict: 'تعذّر قراءة العنصر المشفّر — راجعه', payload: null });
      }
    }
    return out;
  },

  async remove(id) {
    const db = await Offline._openDB();
    await db.del('queue', id);
  },

  async markConflict(id, reason) {
    const db = await Offline._openDB();
    const rows = await db.getAll('queue');
    const row = rows.find(r => r.id === id);
    if (row) { row.conflict = String(reason || 'محتاج مراجعة').slice(0, 300); await db.put('queue', row); }
    await Offline.refreshCount();
    Offline.alertDoctor();
  },

  // قرار الدكتور: «إعادة المحاولة» أو «حذف» — مفيش قرار أوتوماتيك
  async resolveConflict(id, action) {
    const db = await Offline._openDB();
    if (action === 'discard') {
      await db.del('queue', id);
    } else {
      const rows = await db.getAll('queue');
      const row = rows.find(r => r.id === id);
      if (row) { delete row.conflict; await db.put('queue', row); }
    }
    await Offline.refreshCount();
    if (action === 'retry') await Offline.flush();
  },

  async refreshCount() {
    try {
      const db = await Offline._openDB();
      const rows = await db.getAll('queue');
      Offline.pending = rows.length;
      Offline.conflicts = rows.filter(r => r.conflict).map(r => ({
        id: r.id, reason: r.conflict, createdAt: r.createdAt
      }));
    } catch (_) {
      Offline.pending = 0; Offline.conflicts = [];
    }
    Offline.render();
    return Offline.pending;
  },

  // الرفع: بالترتيب، عملية واحدة تفشل ما توقفش الباقي، والفشل الشبكي يوقف ويحتفظ بالباقي
  // لازم جلسة صاحبة البيانات تكون جاهزة قبل أي رفع. لو حدث 'online' جه
  // قبل تسجيل الدخول، ما نرفعش (وإلا RLS هيرفض ويتعمل تعارض وهمي).
  canSync() {
    if (typeof OfflineCapture !== 'undefined' && OfflineCapture.ready) return OfflineCapture.ready();
    return true; // بيئات الاختبار اللي ما تحمّلش offline-capture.js
  },

  async flush(dispatcher) {
    if (Offline._flushing) return { sent: 0, conflicts: 0, skipped: 0, stopped: true };
    if (!Offline.isOnline) return { sent: 0, conflicts: 0, skipped: 0, stopped: true };
    if (!dispatcher && !Offline.canSync()) return { sent: 0, conflicts: 0, skipped: 0, stopped: true };
    const send = dispatcher || Offline.replay || Offline.defaultReplay;
    Offline._flushing = true;
    let sent = 0, conflicts = 0, skipped = 0, stopped = false;
    try {
      const items = await Offline.all();
      for (const item of items) {
        if (item.conflict) { conflicts++; continue; } // مستني مراجعة الدكتور
        if (!item.payload) { await Offline.markConflict(item.id, 'تعذّر قراءة العنصر'); conflicts++; continue; }
        if (!Offline.isOnline) { stopped = true; break; }
        let res;
        try { res = await send(item.payload, item); }
        catch (e) {
          if (Offline.isNetworkError(e)) { stopped = true; break; }
          await Offline.markConflict(item.id, Offline.reasonFor(e));
          conflicts++; continue;
        }
        // «معلّق» (جلسة لسه مش جاهزة): ما يتعلّمش تعارض وما يتحذفش
        if (res && res.skipped) { skipped++; continue; }
        if (res && res.conflict) {
          await Offline.markConflict(item.id, res.reason || 'تعارض في البيانات');
          conflicts++; continue;
        }
        await Offline.remove(item.id);
        sent++;
      }
    } finally {
      Offline._flushing = false;
      await Offline.refreshCount();
    }
    return { sent, conflicts, skipped, stopped };
  },

  isNetworkError(e) {
    const msg = String((e && (e.message || e.code)) || e || '');
    return /Failed to fetch|NetworkError|network request|fetch failed|ERR_NETWORK|offline_no_client|TypeError/i.test(msg);
  },

  reasonFor(e) {
    const all = String((e && e.code) || '') + ' ' + String((e && e.message) || '');
    if (/23505|duplicate|unique|مكرر/i.test(all)) return 'تكرار بيانات موجودة بالفعل على السيرفر — راجعها قبل الرفع';
    if (/42501|forbidden|permission/i.test(all)) return 'الصلاحية أو الجلسة خلصت — سجّل دخول تاني ثم أعد المحاولة';
    return String((e && (e.message || e.code)) || 'فشل الرفع — راجع العنصر').slice(0, 300);
  },

  // مُرسِل افتراضي: كل الرفع بيمر على عميل Supabase المضبوط في supabaseConfig فقط
  async defaultReplay(op) {
    if (typeof DB === 'undefined' || !DB.sb) throw { code: 'offline_no_client', message: 'لا يوجد اتصال بالسيرفر' };
    if (op && op.kind === 'insert') {
      const { data, error } = await DB.sb.from(op.table).insert(op.row).select();
      if (error) throw error; return data;
    }
    if (op && op.kind === 'update') {
      const { error } = await DB.sb.from(op.table).update(op.row).eq('id', op.id);
      if (error) throw error; return { ok: true };
    }
    if (op && op.kind === 'rpc') {
      const { data, error } = await DB.sb.rpc(op.name, op.args || {});
      if (error) throw error; return data;
    }
    throw { code: 'offline_unknown_op', message: 'نوع عملية غير معروف' };
  },

  setRole(role) {
    Offline.role = (role === 'patient') ? 'patient' : 'clinic';
    Offline.render();
  },

  // على جهاز العيادة: تنبيه للدكتور يراجع. على موبايل المريض: مفيش دكتور
  // قدامه، فبنقوله يحتفظ بالبيانات ولا يمسحها ولازم يوصلها للعيادة.
  alertDoctor() {
    if (typeof toast === 'function') {
      toast(Offline.role === 'patient'
        ? '⚠️ التسجيل ده محتاج مراجعة الدكتور — احتفظ بالبيانات على جهازك ولا تمسحها'
        : '⚠️ فيه تسجيل محتاج مراجعتك — اضغط على شريط الحالة فوق', 'error');
    }
    Offline._panelOpen = true;
    Offline.render();
  },

  // ---------- الواجهة ----------
  bindUI() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const bar = document.getElementById('offlineBar');
    if (!bar || bar.__offlineBound) return;
    bar.__offlineBound = true;
    bar.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-offline-action]') : null;
      if (!b) return;
      const act = b.dataset.offlineAction, id = b.dataset.offlineId;
      if (act === 'toggle') { Offline._panelOpen = !Offline._panelOpen; Offline.render(); }
      else if (act === 'flush') Offline.flush().catch(err => Offline.log(err, 'offline.flush.manual'));
      else if (act === 'retry') Offline.resolveConflict(id, 'retry').catch(err => Offline.log(err, 'offline.retry'));
      else if (act === 'discard') Offline.resolveConflict(id, 'discard').catch(err => Offline.log(err, 'offline.discard'));
    });
  },

  render() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const bar = document.getElementById('offlineBar');
    if (!bar) return;
    const offline = !Offline.isOnline, pending = Offline.pending, conflicts = Offline.conflicts.length;
    const show = offline || pending > 0 || conflicts > 0;
    bar.hidden = !show;
    bar.style.display = show ? 'flex' : 'none'; // inline display لوحده بيتغلب على hidden
    const label = document.getElementById('offlineLabel');
    if (label) label.textContent = offline
      ? 'النت مقطوع — الكتابة هتتحفظ على هذا الجهاز فقط (مشفّرة) وهتترفع أول ما النت يرجع'
      : (pending > 0 ? 'فيه ' + pending + ' تسجيل مستني رفع للسيرفر…'
        : 'فيه ' + conflicts + ' تسجيل محتاج مراجعتك');
    const pendingEl = document.getElementById('offlinePending');
    if (pendingEl) {
      pendingEl.textContent = 'معلّق: ' + pending;
      pendingEl.style.display = pending > 0 ? '' : 'none';
    }
    const review = document.getElementById('offlineReviewBtn');
    if (review) {
      review.style.display = conflicts > 0 ? '' : 'none';
      const n = document.getElementById('offlineConflictCount');
      if (n) n.textContent = conflicts;
    }
    const flushBtn = document.getElementById('offlineFlushBtn');
    if (flushBtn) flushBtn.style.display = (!offline && pending > 0) ? '' : 'none';
    const panel = document.getElementById('offlinePanel');
    if (panel) {
      panel.style.display = (Offline._panelOpen && conflicts > 0) ? 'block' : 'none';
      // على موبايل المريض: ما نديهوش زر «حذف» لتسجيل محتاج مراجعة الدكتور
      const canDiscard = Offline.role !== 'patient';
      panel.innerHTML = conflicts
        ? (canDiscard ? '' : '<p class="p-small" style="margin:0 0 6px">البيانات دي محتاجة مراجعة الدكتور — احتفظ بيها على جهازك ولا تمسحها.</p>') +
          Offline.conflicts.map(c =>
          '<div class="sys-row"><span>' + safeText(c.reason) +
          ' <small class="muted ltr">' + safeText(c.createdAt) + '</small></span>' +
          '<button class="btn btn-ghost sm" type="button" data-offline-action="retry" data-offline-id="' + safeText(c.id) + '">إعادة المحاولة</button>' +
          (canDiscard ? '<button class="btn btn-outline sm" type="button" data-offline-action="discard" data-offline-id="' + safeText(c.id) + '">حذف</button>' : '') +
          '</div>').join('')
        : '';
    }
  },

  log(e, ctx) {
    if (typeof logError === 'function') { try { logError(e, ctx); } catch (_) { /* no-op */ } }
  }
};

function safeText(v) {
  return (typeof esc === 'function') ? esc(v == null ? '' : v) : String(v == null ? '' : v);
}

// غلاف صغير لـ IndexedDB يحوّل الطلبات لـ Promises
function idbWrap(db) {
  const run = (store, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    getAll: s => run(s, 'readonly', o => o.getAll()),
    get: (s, k) => run(s, 'readonly', o => o.get(k)),
    put: (s, v) => run(s, 'readwrite', o => o.put(v)),
    del: (s, k) => run(s, 'readwrite', o => o.delete(k))
  };
}

if (typeof document !== 'undefined') {
  try { Offline.init(); } catch (e) { Offline.log(e, 'offline.init'); }
}
