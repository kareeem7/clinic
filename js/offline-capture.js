/**
 * ========================================
 * offline-capture.js
 * الوظيفة: الدفعة ٢ — ربط الكتابة الفعلية بالدفتر المشفّر على جهاز المستخدم
 *          (جهاز العيادة أو موبايل المريض)، ثم إعادة تشغيلها على Supabase.
 * الدوال الرئيسية: OfflineCapture.call / uuid / patientInsertOps / replay
 * الاعتمادات: offline.js (الدفتر)، db.js (DB/toRow/State)، patient-portal.js (Portal)
 * آخر تعديل: 2026-11-04 — الدفعة ٢
 * ========================================
 */
'use strict';

/* ============================================================
   قواعد أمان غير قابلة للتفاوض
   ------------------------------------------------------------
   1) مفيش توكن ولا كود دخول ولا صور جوه الدفتر. بوابة المريض بتحتاج
      p_token في كل RPC، فبنخزّن علامة `__session` بس، وعند الرفع بنقرأ
      التوكن الحالي من Portal.token (الذاكرة/sessionStorage) ونحقنه ساعتها.
   2) كل عملية بتتقيّد بهوية صاحبها (doctorId / clinicId / patientId).
      لو اتسجّل دخول بحساب تاني قبل الرفع → تعارض وتنبيه، مش رفع غلط.
      ده بيمنع أخطر حاجة: بيانات مريض تترفع على حساب مريض تاني.
   3) كل صف جديد بياخد UUID مولّد على الجهاز قبل ما يتسجّل. كده الـ id
      نفسه بيبقى ثابت في الدفتر وفي قاعدة البيانات، فمفيش إعادة تسمية
      ولا قياسات تايهة، والرفع المتكرر آمن (upsert ignoreDuplicates).
   4) أي رفض من السيرفر (حد ٢٠ كتابة/يوم، تاريخ أقدم من أسبوع، جلسة
      منتهية...) → تعارض وتنبيه للدكتور يراجعه، مش محاولة أوتوماتيك.
   ============================================================ */
const OfflineCapture = {
  replaying: false,

  uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  },

  // الهوية بتتقرأ لحظة التسجيل، مش من إعدادات محفوظة
  identity(origin) {
    const role = origin === 'patient' ? 'patient' : 'clinic';
    let doctorId = null, clinicId = null, patientId = null;
    try { if (typeof DB !== 'undefined' && DB.uid) doctorId = DB.uid; } catch (_) { /* no-op */ }
    try { if (typeof State !== 'undefined' && State.activeClinicId) clinicId = State.activeClinicId; } catch (_) { /* no-op */ }
    try {
      if (role === 'patient' && typeof Portal !== 'undefined' && Portal.data && Portal.data.patient)
        patientId = Portal.data.patient.id || null;
    } catch (_) { /* no-op */ }
    return { origin: role, doctorId, clinicId, patientId };
  },

  portalToken() {
    try { return (typeof Portal !== 'undefined' && Portal.token) || null; } catch (_) { return null; }
  },

  currentPatientId() {
    try {
      return (typeof Portal !== 'undefined' && Portal.data && Portal.data.patient && Portal.data.patient.id) || null;
    } catch (_) { return null; }
  },

  decorate(op) {
    const who = OfflineCapture.identity(op.origin);
    return Object.assign({}, op, {
      v: 1,
      origin: who.origin,
      doctorId: op.doctorId || who.doctorId,
      clinicId: op.clinicId || who.clinicId,
      patientId: op.patientId || who.patientId,
      requestId: op.requestId || OfflineCapture.uuid(),
      label: op.label || 'تسجيل بيانات'
    });
  },

  /**
   * نقطة الالتقاط الوحيدة: بتلفّ **نداء شبكة واحد**.
   * ops: عملية واحدة أو مصفوفة عمليات مرتّبة (كلها بتتسجّل بنفس الترتيب).
   * live: النداء الحقيقي. fake: الرد المتوقّع لما النت مقطوع (عشان باقي
   *       كود الميثود يكمّل ويحدّث الذاكرة من غير ما يكذب على الدكتور).
   */
  async call(ops, live, fake) {
    if (OfflineCapture.replaying) return live();
    if (typeof Offline === 'undefined') return live();
    const list = (Array.isArray(ops) ? ops : [ops]).map(o => OfflineCapture.decorate(o));
    if (!Offline.isOnline) return OfflineCapture.queue(list, fake);
    try { return await live(); }
    catch (e) {
      if (Offline.isNetworkError(e)) return OfflineCapture.queue(list, fake);
      throw e;
    }
  },

  async queue(list, fake) {
    try {
      for (const op of list) await Offline.enqueue(op); // assertSafe يمنع الأكواد/التوكنات
    } catch (e) {
      // أخطاء الأمان/التشفير لازم توصل باسمها الصريح (وليس كخطأ عام)
      if (e && (e.code === 'offline_forbidden_field' || e.code === 'offline_crypto_missing')) throw e;
      throw { code: 'offline_capture_failed',
        message: (e && e.message) || 'تعذّر الحفظ المشفّر على هذا الجهاز — لم تُحفظ أي بيانات' };
    }
    Offline.setRole(list[0].origin);
    if (!Offline.isOnline && typeof toast === 'function') {
      toast('اتحفظ على هذا الجهاز فقط (مشفّر) وهيترفع أول ما النت يرجع', 'info');
    }
    Offline.refreshCount().catch(e => Offline.log(e, 'offline.capture.count'));
    return fake;
  },

  /** مريض جديد أوفلاين: صف المريض + قياسات البداية، كلهم بـ UUID ثابت.
   *  ليه مش الـ RPC؟ لأن create_patient_with_measurements بيولّد الـ id
   *  جوه Postgres، فكان هيحصل تضارب مع النسخة المحلية. هنا بنبقى إحنا
   *  اللي بنولّد الـ id مرة واحدة على الجهاز، والرفع بيستخدمه زي ما هو. */
  patientInsertOps(data, uid, clinicId) {
    const id = OfflineCapture.uuid();
    const row = toRow('patients', data);
    delete row.id; delete row.measurements;
    row.id = id; row.doctor_id = uid;
    // clinic_id بنحطه في وصف العملية (decorate) مش في الصف هنا:
    // ترحيل 20261111 لسه مش مطبّق على بعض القواعد، والعمود ممكن يكون غايب.
    const ops = [{ kind: 'insert', table: 'patients', row, label: 'مريض جديد', clinicId }];
    for (const m of (data.measurements || [])) {
      const r = toRow('patient_records', m);
      delete r.id; delete r.patient_id;
      r.id = OfflineCapture.uuid();
      r.doctor_id = uid; r.patient_id = id; r.source = 'clinic';
      ops.push({ kind: 'insert', table: 'patient_records', row: r, label: 'قياس بداية', clinicId });
    }
    return { ops, id };
  },

  /** مُرسِل الرفع: بيتنادى من Offline.flush() لكل عملية بالترتيب. */
  async replay(op) {
    if (typeof DB === 'undefined' || !DB.sb) throw { code: 'offline_no_client', message: 'لا يوجد اتصال بالسيرفر' };
    let token = null;
    if (op.origin === 'patient') {
      token = OfflineCapture.portalToken();
      // جلسة منتهية/لسه مش محمّلة = الحالة «معلّق»، مش تعارض: أول ما يسجّل
      // دخول تاني syncWhenReady() بيرفعه لوحده من غير ضغطة من المريض.
      if (!token) return { skipped: true };
      const current = OfflineCapture.currentPatientId();
      if (!current) return { skipped: true };
      if (op.patientId && op.patientId !== current) {
        return { conflict: true, reason: 'الجلسة الحالية لمريض آخر — التسجيل لن يُرفع على حساب خاطئ، راجع العيادة' };
      }
    } else {
      const uid = (typeof DB !== 'undefined' && DB.uid) || null;
      if (!uid) return { skipped: true };
      if (op.doctorId && op.doctorId !== uid) {
        return { conflict: true, reason: 'تسجيل دخول بحساب دكتور آخر — سجّل الدخول بنفس الحساب الذي سجّل البيانات' };
      }
    }

    OfflineCapture.replaying = true;
    try {
      if (op.kind === 'insert') {
        // id مولّد على الجهاز + ignoreDuplicates = إعادة الرفع آمنة بعد رد ضايع
        let row = Object.assign({}, op.row);
        if (op.clinicId) row.clinic_id = op.clinicId; // ينتمي للفرع اللي اتسجّل فيه
        const send = r => DB.sb.from(op.table)
          .upsert(r, { onConflict: 'id', ignoreDuplicates: true }).select();
        let res = await send(row);
        // قاعدة لسه ما طبّقتش 20261111 → العمود غايب (42703): نعيد بدون الفرع
        if (res.error && /42703|column .* does not exist/i.test(
          String(res.error.code || '') + ' ' + String(res.error.message || ''))) {
          const legacy = Object.assign({}, row); delete legacy.clinic_id;
          res = await send(legacy);
        }
        if (res.error) throw res.error;
        await OfflineCapture.auditReplay(op);
        return res.data;
      }
      if (op.kind === 'update') {
        let q = DB.sb.from(op.table).update(op.row);
        for (const f of (op.where || [])) q = f.op === 'is' ? q.is(f.col, f.val) : q.eq(f.col, f.val);
        const { error } = await q;
        if (error) throw error;
        await OfflineCapture.auditReplay(op);
        return { ok: true };
      }
      if (op.kind === 'rpc') {
        const args = Object.assign({}, op.args || {});
        if (args.__session) { delete args.__session; args.p_token = token; }
        const { data, error } = await DB.sb.rpc(op.name, args);
        if (error) throw error;
        // الـ RPC بتاعة البوابة بترجع ok:false بدل ما ترمي خطأ (حد يومي/جلسة/تاريخ)
        if (data && data.ok === false) {
          throw { code: 'rpc_rejected', message: String(data.error || 'السيرفر رفض التسجيل') };
        }
        return data;
      }
      throw { code: 'offline_unknown_op', message: 'نوع عملية غير معروف' };
    } finally {
      OfflineCapture.replaying = false;
    }
  },

  // سطر تدقيق واحد لكل عملية مرفوعة من جهاز العيادة (بدون أي بيانات مرضى)
  async auditReplay(op) {
    if (op.origin !== 'clinic' || typeof DB === 'undefined' || typeof DB.audit !== 'function') return;
    try {
      await DB.audit('sync', op.table || op.name,
        (op.row && op.row.id) || null, { offline: true, requestId: op.requestId });
    } catch (_) { /* التدقيق ما يوقفش الرفع */ }
  },

  enter(role) {
    if (typeof Offline !== 'undefined') Offline.setRole(role);
  },

  // جلسة الدكتور أو جلسة المريض لازم تكون قائمة قبل أي رفع
  ready() {
    try {
      if (typeof DB !== 'undefined' && DB.sb && DB.uid) return true;
      if (typeof Portal !== 'undefined' && Portal.token && Portal.data && Portal.data.patient) return true;
    } catch (_) { /* no-op */ }
    return false;
  },

  // أول ما تتأكد الهوية (دخول أو استعادة جلسة) نرفع المعلّق فوراً
  syncWhenReady() {
    if (typeof Offline === 'undefined' || !Offline.isOnline) return;
    Offline.refreshCount()
      .then(n => { if (n > 0) return Offline.flush(); })
      .catch(e => Offline.log(e, 'offline.ready.flush'));
  },

  install() {
    if (typeof Offline === 'undefined') return;
    Offline.replay = OfflineCapture.replay;
    // موبايل المريض: التوكن ممكن يكون متخزّن في sessionStorage من قبل
    try {
      if (typeof Portal !== 'undefined' && Portal.token) Offline.setRole('patient');
    } catch (_) { /* no-op */ }
  }
};

OfflineCapture.install();
