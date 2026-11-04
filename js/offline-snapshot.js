/**
 * ========================================
 * offline-snapshot.js
 * الوظيفة: الدفعة ٤ من الأوفلاين — نسخة مشفّرة **للقراءة فقط** من بيانات
 *          بوابة المريض على الجهاز، عشان البوابة تفتح أوفلاين حتى بعد reload
 *          أو إعادة فتح التبويب، بدل ما تكون البيانات في الذاكرة بس.
 * الدوال الرئيسية: OfflineSnapshot.save / read / restore / clear / sanitize
 * الاعتمادات: offline.js (المفتاح المشفّر + IndexedDB)، patient-portal.js (Portal)
 * آخر تعديل: 2026-11-05 — الدفعة ٤
 * ========================================
 */
'use strict';

/* ============================================================
   القواعد (ثابتة من الدفعات السابقة)
   ------------------------------------------------------------
   1) نسخة على جهاز صاحبه فقط، مشفّرة بنفس مفتاح الجهاز غير القابل للتصدير.
   2) 🚫 **مفيش كود دخول ولا توكن ولا صور جوه الدفتر**: بنشيل `accessCode`
      وأي مفتاح شبيه قبل التشفير، و`Offline.assertSafe` بيتأكد بعد التنظيف.
   3) النسخة **للقراءة فقط**: ما بتستبدلش جلسة حقيقية، ومش مسموح
      الوصول ليها من غير وجود توكن الجلسة في نفس المتصفح (sessionStorage).
   4) أول دخول لازم يكون أونلاين؛ النسخة بتتجدّد بعد كل تحميل ناجح،
      وبتتمسح عند تسجيل الخروج صراحةً.
   ============================================================ */

const OfflineSnapshot = {
  KEY: 'portalSnapshot',
  MAX_AGE_DAYS: 30,
  VERSION: 1,

  // تنظيف تعاودي: أي مفتاح اسمه code/token/... يتشال قبل ما يقرب من الدفتر
  sanitize(value) {
    if (Array.isArray(value)) return value.map(v => OfflineSnapshot.sanitize(v));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const k of Object.keys(value)) {
      if (/code|token|password|secret|api_?key|authorization|bearer/i.test(k)) continue;
      out[k] = OfflineSnapshot.sanitize(value[k]);
    }
    return out;
  },

  async save(data) {
    if (typeof Offline === 'undefined' || !Offline.encryption) return false;
    try {
      const clean = OfflineSnapshot.sanitize(data || {});
      Offline.assertSafe(clean); // لو فات حاجة، منكتبش خالص
      const key = await Offline.deviceKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const body = {
        v: OfflineSnapshot.VERSION,
        savedAt: new Date().toISOString(),
        patientId: (clean.patient && clean.patient.id) || null,
        data: clean
      };
      const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(JSON.stringify(body)));
      const db = await Offline._openDB();
      await db.put('meta', { k: OfflineSnapshot.KEY,
        iv: Array.from(iv), data: Array.from(new Uint8Array(buf)) });
      return true;
    } catch (e) {
      if (typeof Offline !== 'undefined') Offline.log(e, 'offline.snapshot.save');
      return false;
    }
  },

  async read() {
    if (typeof Offline === 'undefined' || !Offline.encryption) return null;
    try {
      const db = await Offline._openDB();
      const row = await db.get('meta', OfflineSnapshot.KEY);
      if (!row) return null;
      const key = await Offline.deviceKey();
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(row.iv) }, key, new Uint8Array(row.data));
      const body = JSON.parse(new TextDecoder().decode(plain));
      if (!body || body.v !== OfflineSnapshot.VERSION || !body.data) return null;
      const ageDays = (Date.now() - Date.parse(body.savedAt)) / 86400000;
      return { data: body.data, savedAt: body.savedAt, patientId: body.patientId,
        stale: !Number.isFinite(ageDays) || ageDays > OfflineSnapshot.MAX_AGE_DAYS };
    } catch (e) {
      if (typeof Offline !== 'undefined') Offline.log(e, 'offline.snapshot.read');
      return null;
    }
  },

  async clear() {
    if (typeof Offline === 'undefined') return;
    try { const db = await Offline._openDB(); await db.del('meta', OfflineSnapshot.KEY); }
    catch (e) { Offline.log(e, 'offline.snapshot.clear'); }
    Offline.snapshotNote = null;
    if (typeof Offline.render === 'function') Offline.render();
  },

  fmt(iso) {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(iso));
    } catch (_) { return String(iso || '').slice(0, 16).replace('T', ' '); }
  },

  /** استعادة العرض الأوفلاين بعد فشل `patient_portal_data` بسبب الشبكة.
   *  بنرفض لو مفيش توكن جلسة في نفس المتصفح — النسخة مش بديل عن الدخول. */
  async restore(portal) {
    if (typeof Offline === 'undefined' || !Offline.encryption) return false;
    if (!portal || !portal.token) return false;
    const snap = await OfflineSnapshot.read();
    if (!snap || !snap.data || !snap.data.patient || !snap.data.clinic) return false;

    const d = snap.data;
    d.accessCode = null; // الكود عمره ما خرج من الدفتر — الواجهة هتظهر '—'
    d.healthTracking = d.healthTracking || { glucose: false, bloodPressure: false };
    portal.data = d;
    portal.offlineSnapshot = snap.savedAt;
    Offline.snapshotNote = '📴 نسخة أوفلاين للقراءة من ' + OfflineSnapshot.fmt(snap.savedAt) +
      (snap.stale ? ' — قديمة، راجع العيادة' : '') + '؛ أي تسجيل جديد هيتحفظ ويُرفع أول ما النت يرجع';
    if (typeof Offline.setRole === 'function') Offline.setRole('patient');
    try {
      if (typeof document !== 'undefined' && document.body) document.body.classList.add('theme-patient');
      if (typeof portal.render === 'function') portal.render();
      if (typeof showScreen === 'function') showScreen('portal');
    } catch (e) { Offline.log(e, 'offline.snapshot.render'); }
    if (typeof toast === 'function') {
      toast('النت مقطوع — بتشوف نسخة مشفّرة محفوظة على جهازك من ' +
        OfflineSnapshot.fmt(snap.savedAt), 'info');
    }
    return true;
  }
};
