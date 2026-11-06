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
  remoteTickets: [],     // الدفعة ٤: تذاكر واردة من أجهزة المرضى (ترحيل 20261114)
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
    if (Offline.encryption) Offline.purgeOrphanPhotos().catch(e => Offline.log(e, 'offline.photos.purge'));
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
      // v2: أضفنا مخزن 'photos' للصور المشفّرة (الدفعة ٤).
      // onupgradeneeded بينشئ أي مخزن ناقص، فالترقية آمنة من v1 ومن تثبيت جديد.
      const req = indexedDB.open('clinic-offline-v1', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'k' });
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
        const decoded = JSON.parse(new TextDecoder().decode(plain));
        out.push({
          id: r.id, requestId: r.requestId, createdAt: r.createdAt,
          conflict: r.conflict || null, forced: !!decoded.forced, payload: decoded
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
    const rows = await db.getAll('queue');
    const row = rows.find(r => r.id === id);
    await db.del('queue', id);
    // الصورة المشفّرة المرتبطة بالعملية تتمسح معاها (نجاح أو حذف بقرار الدكتور)
    if (row && row.requestId) { try { await db.del('photos', row.requestId); } catch (_) {} }
  },

  // ---------- صور القياسات المشفّرة (الدفعة ٤) ----------
  // البايتات نفسها تتشفّر AES-GCM؛ اسم الملف مش بيتخزّن أصلاً (ممكن يكون فيه PHI)،
  // والميتاداتا الوحيدة هي نوع MIME من 3 قيم ثابتة.
  putPhoto(requestId, bytes, type) {
    if (!Offline.encryption) throw { code: 'offline_crypto_missing', message: 'التشفير غير متاح' };
    const allowed = { 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'image/webp': 'photo.webp' };
    if (!allowed[type]) throw { code: 'offline_photo_type', message: 'صيغة الصورة غير مدعومة' };
    if (!bytes || bytes.byteLength > 5 * 1024 * 1024) throw { code: 'offline_photo_size', message: 'الصورة أكبر من 5MB' };
    return (async () => {
      const key = await Offline.deviceKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
      const db = await Offline._openDB();
      await db.put('photos', { k: requestId, iv: Array.from(iv),
        data: Array.from(new Uint8Array(buf)), type });
      return requestId;
    })();
  },

  async getPhoto(requestId) {
    const db = await Offline._openDB();
    const row = await db.get('photos', requestId);
    if (!row) return null;
    const key = await Offline.deviceKey();
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(row.iv) }, key, new Uint8Array(row.data));
    return { bytes: new Uint8Array(buf), type: row.type,
      name: ({ 'image/jpeg': 'photo.jpg', 'image/png': 'photo.png', 'image/webp': 'photo.webp' })[row.type] || 'photo.jpg' };
  },

  async dropPhoto(requestId) {
    if (!requestId) return;
    const db = await Offline._openDB();
    await db.del('photos', requestId);
  },

  /** تنظيف تلقائي: صورة مشفّرة من غير عملية في الدفتر (عنصر اتمسح أو تلف)
   *  ما تفضلش على الجهاز للأبد. يتنادى عند الإقلاع وبعد كل رفع. */
  async purgeOrphanPhotos() {
    try {
      const db = await Offline._openDB();
      const used = new Set((await Offline.all()).map(i => i.requestId));
      let removed = 0;
      for (const r of await db.getAll('photos')) {
        if (!used.has(r.k)) { await db.del('photos', r.k); removed++; }
      }
      return removed;
    } catch (e) { Offline.log(e, 'offline.photos.purge'); return 0; }
  },

  /** مسح النسخ المشفّرة للقراءة فقط — **من غير** لمس الدفتر المعلّق. */
  async clearSnapshot() {
    if (typeof OfflineSnapshot !== 'undefined') {
      try { await OfflineSnapshot.clearAll(); } catch (e) { Offline.log(e, 'offline.snapshot.clear'); }
    }
    Offline.snapshotNote = null;
    Offline.render();
    if (typeof toast === 'function') {
      toast('اتمسحت النسخة الأوفلاين من الجهاز — التسجيلات المعلّقة ما اتمسّتش', 'info');
    }
  },

  // «نسخة أوفلاين» بتاعة البوابة (الدفعة ٤) — بتظهر في شريط الحالة
  snapshotNote: null,

  // تعديل علم جوه العملية المشفّرة (مثلاً «الدكتور أكّد الرفع»).
  // بنعيد التشفير بـ iv جديد، والبيانات ما تطلعش من الذاكرة أبداً.
  async setFlag(id, name, value) {
    const db = await Offline._openDB();
    const rows = await db.getAll('queue');
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const key = await Offline.deviceKey();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(row.iv) }, key, new Uint8Array(row.data));
    const obj = JSON.parse(new TextDecoder().decode(plain));
    obj[name] = value;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(obj)));
    row.iv = Array.from(iv); row.data = Array.from(new Uint8Array(buf));
    await db.put('queue', row);
  },

  async markConflict(id, reason, kind) {
    const db = await Offline._openDB();
    const rows = await db.getAll('queue');
    const row = rows.find(r => r.id === id);
    if (row) {
      row.conflict = String(reason || 'محتاج مراجعة').slice(0, 400);
      row.conflictKind = String(kind || 'unknown').slice(0, 40);
      await db.put('queue', row);
    }
    await Offline.refreshCount();
    Offline.alertDoctor();
  },

  // قرار الدكتور: «إعادة المحاولة» أو «حذف» — مفيش قرار أوتوماتيك
  async resolveConflict(id, action) {
    const db = await Offline._openDB();
    if (action === 'discard') {
      await Offline.remove(id); // بيمسح الصورة المشفّرة المرتبطة كمان
    } else {
      if (action === 'force') await Offline.setFlag(id, 'forced', true);
      const rows = await db.getAll('queue');
      const row = rows.find(r => r.id === id);
      if (row) { delete row.conflict; delete row.conflictKind; await db.put('queue', row); }
    }
    await Offline.refreshCount();
    if (action === 'retry' || action === 'force') await Offline.flush();
  },

  async refreshCount() {
    try {
      const db = await Offline._openDB();
      const rows = await db.getAll('queue');
      Offline.pending = rows.length;
      const meta = Offline.encryption ? await Offline.all() : [];
      const byId = new Map(meta.map(x => [x.id, x]));
      // التذكرة فيها وصف العملية والسبب ورقم الطلب فقط — بلا اسم مريض ولا قيم سريرية
      Offline.conflicts = rows.filter(r => r.conflict).map(r => {
        const m = byId.get(r.id), p = (m && m.payload) || {};
        return {
          id: r.id, reason: r.conflict, kind: r.conflictKind || 'unknown',
          createdAt: r.createdAt, label: p.label || 'تسجيل بيانات',
          origin: p.origin || 'clinic', requestId: p.requestId || r.requestId
        };
      });
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
          const c = (typeof OfflineCapture !== 'undefined' && OfflineCapture.classifyThrown)
            ? OfflineCapture.classifyThrown(e) : { kind: 'unknown', reason: Offline.reasonFor(e) };
          await Offline.markConflict(item.id, c.reason, c.kind);
          Offline.reportConflictRemote(item, c.kind, c.reason);
          conflicts++; continue;
        }
        // «معلّق» (جلسة لسه مش جاهزة): ما يتعلّمش تعارض وما يتحذفش
        if (res && res.skipped) { skipped++; continue; }
        if (res && res.conflict) {
          const reason = res.reason || 'تعارض في البيانات';
          await Offline.markConflict(item.id, reason, res.kind);
          Offline.reportConflictRemote(item, res.kind, reason);
          conflicts++; continue;
        }
        // alreadyApplied: السيرفر حقّق المطلوب فعلاً في محاولة سابقة (رد ضايع)
        await Offline.remove(item.id);
        sent++;
      }
    } finally {
      Offline._flushing = false;
      await Offline.refreshCount();
      if (Offline.encryption) Offline.purgeOrphanPhotos().catch(e => Offline.log(e, 'offline.photos.purge'));
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

  /** بلاغ «أفضل جهد» للدكتور على أي جهاز. بلا بيانات مرضى، وبلا توكن مخزّن.
   *  لو ترحيل 20261114 لسه ما اتطبّقش، التذكرة المحلية هي البديل. */
  reportConflictRemote(item, kind, reason) {
    if (typeof OfflineCapture === 'undefined' || !OfflineCapture.reportConflict) return;
    const p = (item && item.payload) || {};
    if (p.origin !== 'patient') return; // تعارضات جهاز العيادة الدكتور شايفها أصلاً
    // 🚫 تعارض هوية: التوكن الحالي لمريض **تاني**، فأي بلاغ هيتربط بحساب غلط
    if (kind === 'identity') return;
    const current = OfflineCapture.currentPatientId ? OfflineCapture.currentPatientId() : null;
    if (p.patientId && current && p.patientId !== current) return;
    OfflineCapture.reportConflict({
      origin: p.origin, requestId: item.requestId, kind: kind || 'unknown',
      label: p.label || 'تسجيل بيانات', reason: reason || ''
    }).catch(e => Offline.log(e, 'offline.report.remote'));
  },

  async refreshRemoteTickets() {
    if (typeof OfflineCapture === 'undefined' || !OfflineCapture.listConflicts) return;
    if (Offline.role === 'patient' || !Offline.isOnline) return;
    try {
      Offline.remoteTickets = await OfflineCapture.listConflicts();
    } catch (e) { Offline.remoteTickets = []; Offline.log(e, 'offline.remote.list'); }
    Offline.render();
  },

  async ackRemoteTicket(id) {
    if (typeof OfflineCapture === 'undefined' || !OfflineCapture.ackConflict) return;
    const ok = await OfflineCapture.ackConflict(id);
    if (ok) await Offline.refreshRemoteTickets();
    else if (typeof toast === 'function') toast('ما قدرناش نقفل التذكرة — تأكد إن الترحيل متطبّق', 'error');
  },

  setRole(role) {
    Offline.role = (role === 'patient') ? 'patient' : 'clinic';
    Offline.render();
    if (Offline.role === 'clinic') Offline.refreshRemoteTickets();
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
      else if (act === 'force') Offline.resolveConflict(id, 'force').catch(err => Offline.log(err, 'offline.force'));
      else if (act === 'discard') Offline.resolveConflict(id, 'discard').catch(err => Offline.log(err, 'offline.discard'));
      else if (act === 'copy-report') Offline.copyReport();
      else if (act === 'refresh-remote') Offline.refreshRemoteTickets().catch(e => Offline.log(e, 'offline.remote.refresh'));
      else if (act === 'ack-remote') Offline.ackRemoteTicket(id).catch(e => Offline.log(e, 'offline.remote.ack'));
      else if (act === 'clear-snapshot') Offline.clearSnapshot().catch(e => Offline.log(e, 'offline.snapshot.clear'));
    });
  },

  // تذكرة مراجعة قابلة للنقل بين الأجهزة: **بلا أي بيانات مرضى**
  // (وصف العملية + السبب + رقم الطلب فقط). المريض يقدر يوريها للدكتور،
  // والدكتور يعرف إن البيانات لسه على الجهاز وما وصلتش للسيرفر.
  reportText() {
    const lines = ['تذكرة مراجعة أوفلاين — عيادتي', '────────────────────'];
    for (const c of Offline.conflicts) {
      lines.push('العملية: ' + c.label);
      lines.push('نوع التعارض: ' + (c.kind || 'unknown'));
      lines.push('السبب: ' + c.reason);
      lines.push('التوقيت: ' + c.createdAt);
      lines.push('رقم الطلب: ' + c.requestId);
      lines.push('الجهاز: ' + (c.origin === 'patient' ? 'موبايل المريض' : 'جهاز العيادة'));
      lines.push('────────────────────');
    }
    lines.push('⚠️ البيانات دي لسه على الجهاز، مش على السيرفر. اعرض التذكرة على الدكتور.');
    return lines.join('\n');
  },

  async copyReport() {
    const text = Offline.reportText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (typeof toast === 'function') toast('اتنسخ تقرير المراجعة — احتفظ بيه ووريه للدكتور', 'info');
      } else if (typeof toast === 'function') {
        toast('النسخ مش متاح في المتصفح ده — افتح شريط الحالة واكتب رقم الطلب للدكتور', 'info');
      }
    } catch (e) { Offline.log(e, 'offline.report'); }
  },

  render() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const bar = document.getElementById('offlineBar');
    if (!bar) return;
    const offline = !Offline.isOnline, pending = Offline.pending, conflicts = Offline.conflicts.length;
    const show = offline || pending > 0 || conflicts > 0 ||
      !!Offline.snapshotNote || (Offline.role === 'clinic' && Offline.remoteTickets.length > 0);
    bar.hidden = !show;
    bar.style.display = show ? 'flex' : 'none'; // inline display لوحده بيتغلب على hidden
    // الشريط sticky في تدفّق الصفحة؛ نزاح #topbar (sticky) تحته عند السكرول
    if (typeof document !== 'undefined' && document.body && document.body.classList) {
      document.body.classList.toggle('offline-bar-visible', show);
    }
    const label = document.getElementById('offlineLabel');
    if (label) {
      const full = Offline.snapshotNote
        ? Offline.snapshotNote
        : (offline
          ? 'النت مقطوع — الكتابة هتتحفظ على هذا الجهاز فقط (مشفّرة) وهتترفع أول ما النت يرجع'
          : (pending > 0 ? 'فيه ' + pending + ' تسجيل مستني رفع للسيرفر…'
            : 'فيه ' + conflicts + ' تسجيل محتاج مراجعتك'));
      label.textContent = full;
      // الشريط سطر واحد على الموبايل: النص بيقّصر بصرياً بس يفضل كاملاً هنا وقارئ الشاشة
      label.title = full;
      if (bar.setAttribute) bar.setAttribute('aria-label', full);
    }
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
      const hasPanel = conflicts > 0 || !!Offline.snapshotNote ||
        (Offline.role === 'clinic' && Offline.remoteTickets.length > 0);
      panel.style.display = (Offline._panelOpen && hasPanel) ? 'block' : 'none';
      // على موبايل المريض: ما نديهوش زر «حذف» لتسجيل محتاج مراجعة الدكتور
      const canDiscard = Offline.role !== 'patient';
      const remoteTickets = (Offline.role === 'clinic' && Offline.remoteTickets.length)
        ? '<div class="sys-row" style="display:block;margin:8px 0">' +
          '<b>تذاكر من أجهزة المرضى</b> <small class="muted">(بلا بيانات مرضى — البيانات لسه على جهاز المريض)</small> ' +
          '<button class="btn btn-ghost sm" type="button" data-offline-action="refresh-remote">تحديث</button>' +
          Offline.remoteTickets.map(t =>
            '<div class="sys-row"><span><b>' + safeText(t.label) + '</b> — ' + safeText(t.reason) +
            '<br><small class="muted ltr">' + safeText(t.createdAt) + ' · ' + safeText(t.kind) +
            ' · ' + safeText(t.requestId) + '</small></span>' +
            '<button class="btn btn-outline sm" type="button" data-offline-action="ack-remote" data-offline-id="' +
            safeText(t.id) + '">تمت المراجعة</button></div>').join('') +
          '</div>'
        : '';
      const snapshotRow = Offline.snapshotNote
        ? '<div class="sys-row" style="display:block;margin:8px 0">' +
          '<b>نسخة أوفلاين للقراءة</b> <small class="muted">' + safeText(Offline.snapshotNote) + '</small> ' +
          '<button class="btn btn-outline sm" type="button" data-offline-action="clear-snapshot">مسح النسخة من الجهاز</button>' +
          '</div>'
        : '';
      panel.innerHTML = conflicts
        ? '<p class="p-small" style="margin:0 0 6px">' +
          (canDiscard
            ? 'التسجيلات دي محتاجة قرارك — ما بيترفعش ولا بيتحذف أوتوماتيك.'
            : 'البيانات دي محتاجة مراجعة الدكتور — احتفظ بيها على جهازك ولا تمسحها، واعرض التذكرة على العيادة.') +
          '</p>' +
          '<button class="btn btn-ghost sm" type="button" data-offline-action="copy-report" style="margin-bottom:6px"><i class="fa-solid fa-copy"></i> نسخ تذكرة المراجعة</button>' +
          Offline.conflicts.map(c => {
            const duplicate = /duplicate/i.test(c.kind || '');
            return '<div class="sys-row"><span><b>' + safeText(c.label) + '</b> — ' + safeText(c.reason) +
            '<br><small class="muted ltr">' + safeText(c.createdAt) + ' · ' + safeText(c.kind) +
            ' · ' + safeText(c.requestId) + '</small></span>' +
            (duplicate ? '<button class="btn btn-ghost sm" type="button" data-offline-action="force" data-offline-id="' + safeText(c.id) + '">تأكيد الرفع</button>' : '') +
            '<button class="btn btn-ghost sm" type="button" data-offline-action="retry" data-offline-id="' + safeText(c.id) + '">إعادة المحاولة</button>' +
            (canDiscard ? '<button class="btn btn-outline sm" type="button" data-offline-action="discard" data-offline-id="' + safeText(c.id) + '">حذف</button>' : '') +
            '</div>';
          }).join('') + remoteTickets + snapshotRow
        : (remoteTickets + snapshotRow);
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
