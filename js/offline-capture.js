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
function cairoDate(v) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(v));
  } catch (_) { return String(v || '').slice(0, 10); }
}

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
    if (list[0].origin === 'patient') OfflineCapture.warnBudget().catch(e => Offline.log(e, 'offline.budget'));
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

  /** مُرسِل الرفع: بيتنادى من Offline.flush() لكل عملية بالترتيب.
   *  item فيه الأعلام اللي قررها الدكتور (مثلاً forced بعد تأكيد رفع مكرر). */
  async replay(op, item) {
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

        // ⚠️ patient_portal_add_measurement ليس لها p_request_id على السيرفر،
        // فالرد الضايع + إعادة الرفع ممكن يعمل قياس مكرر. ما نحذفش ولا نكرّر
        // أوتوماتيك: بنسأل السيرفر، ولو فيه شبه تكرار بنطلع تعارض للدكتور.
        if (op.name === 'patient_portal_add_measurement' && !(item && item.forced)) {
          const looksDuplicate = await OfflineCapture.measurementLooksUploaded(args);
          if (looksDuplicate) {
            return { conflict: true, kind: 'possible-duplicate',
              reason: 'محتمل القياس ده اترفع قبل كده (نفس التاريخ والوزن موجود على السيرفر). لو اتأكدت إنه مكرر احذفه، ولو مختلف اضغط «تأكيد الرفع».' };
          }
        }

        const { data, error } = await DB.sb.rpc(op.name, args);
        if (error) throw error;
        // الـ RPC بتاعة البوابة بترجع ok:false بدل ما ترمي خطأ (حد يومي/جلسة/تاريخ)
        if (data && data.ok === false) return OfflineCapture.classifyRpcMessage(data.error);
        return data;
      }
      if (op.kind === 'method') {
        // عمليات لازم تتنفّذ كاملة على السيرفر (قراءة + تحقق + كتابة) زي
        // updateHealthReading. OfflineCapture.replaying = true يخلي offlineCall
        // جوه الميثود يروح للمسار المباشر، فمفيش إعادة تسجيل ولا حلقة.
        const fn = (typeof DB !== 'undefined') && DB[op.method];
        if (typeof fn !== 'function') throw { code: 'offline_unknown_op', message: 'ميثود غير معروف' };
        const result = await fn.apply(DB, op.args || []);
        await OfflineCapture.auditReplay(op);
        return { ok: true, data: result };
      }
      throw { code: 'offline_unknown_op', message: 'نوع عملية غير معروف' };
    } catch (e) {
      if (typeof Offline !== 'undefined' && Offline.isNetworkError(e)) throw e; // توقف مؤقت
      const c = OfflineCapture.classifyThrown(e);
      return { conflict: true, kind: c.kind, reason: c.reason };
    } finally {
      OfflineCapture.replaying = false;
    }
  },

  /** فحص «هل القياس وصل فعلاً؟» عبر RPC قراءة البوابة (مفيش إدراج مباشر لـ anon).
   *  فشل القراءة = فشل شبكي → نوقف الرفع ونحتفظ بالعنصر، ما نرفعش على العمياني. */
  async measurementLooksUploaded(args) {
    const token = OfflineCapture.portalToken();
    if (!token || typeof DB === 'undefined' || !DB.sb) return false;
    const { data, error } = await DB.sb.rpc('patient_portal_records', { p_token: token });
    if (error) throw { message: 'Failed to fetch' };
    if (!data || data.ok === false) return false;
    const rows = Array.isArray(data.records) ? data.records : [];
    const same = (a, b) => (a == null && b == null) ||
      (a != null && b != null && Number(a) === Number(b));
    return rows.some(r =>
      String(r.date) === String(args.p_date) && same(r.weight, args.p_weight) &&
      (!args.p_note || String(r.note || '') === String(args.p_note)) &&
      (args.p_waist == null || same(r.waist, args.p_waist)) &&
      (args.p_hips == null || same(r.hips, args.p_hips)));
  },

  /** تصنيف رفض الـ RPC: جلسة = معلّق، حد يومي/تاريخ = تعارض للدكتور،
   *  «الموعد ملغي بالفعل» = اتحقق المطلوب خلاص (إعادة رفع آمنة). */
  classifyRpcMessage(msg) {
    const m = String(msg || '');
    if (/انتهت جلستك|session/i.test(m)) return { skipped: true };
    if (/الحد اليومي|20 قراءة|20 كتابة/i.test(m)) {
      return { conflict: true, kind: 'daily-limit',
        reason: 'وصلت للحد اليومي (20 كتابة) على السيرفر — التسجيل لسه على الجهاز، راجعه مع الدكتور.' };
    }
    if (/التاريخ|أسبوع/i.test(m)) {
      return { conflict: true, kind: 'date-window',
        reason: 'السيرفر بيقبل قياسات آخر 7 أيام فقط والتسجيل ده أقدم — الدكتور يقرر، مش بنغيّر التاريخ أوتوماتيك.' };
    }
    if (/الموعد مش موجود أو مكتمل أو تاريخه فات/i.test(m)) {
      return { alreadyApplied: true, note: 'الموعد كان ملغياً أو فات بالفعل' };
    }
    if (/العيادة أو ملفك غير متاح|forbidden|permission/i.test(m)) {
      return { conflict: true, kind: 'permission',
        reason: 'العيادة أو ملف المريض غير متاح حالياً على السيرفر — راجع الدكتور.' };
    }
    if (/الصورة|photo/i.test(m)) {
      return { conflict: true, kind: 'attachment',
        reason: 'السيرفر رفض مرجع الصورة — احذف الصورة وأعد المحاولة.' };
    }
    return { conflict: true, kind: 'validation',
      reason: 'السيرفر رفض التسجيل: ' + m.slice(0, 200) + ' — راجعه مع الدكتور.' };
  },

  /** تصنيف أخطاء PostgREST/الشبكة لأسباب عربية واضحة بدل «حدث خطأ غير متوقع». */
  classifyThrown(e) {
    const all = String((e && e.code) || '') + ' ' + String((e && e.message) || e || '');
    if (/23505|duplicate|unique/i.test(all)) {
      return { kind: 'duplicate', reason: 'الصف موجود بالفعل على السيرفر (تكرار) — راجعه مع الدكتور قبل أي قرار.' };
    }
    if (/23503|foreign key/i.test(all)) {
      return { kind: 'foreign-key', reason: 'التسجيل بيشير لصف مش موجود على السيرفر (مريض/موعد اتحذف؟) — راجع الدكتور.' };
    }
    if (/PGRST205|42P01|42703|42883|schema cache|relation .* does not exist/i.test(all)) {
      return { kind: 'schema', reason: 'قاعدة البيانات غير محدّثة — طبّق ملفات الترحيل على Supabase ثم أعد المحاولة.' };
    }
    if (/42501|permission|forbidden|row-level/i.test(all)) {
      return { kind: 'permission', reason: 'الصلاحية أو جلسة MFA خلصت — سجّل دخول تاني ثم أعد المحاولة.' };
    }
    if (/invalid|22\d\d\d|check constraint|value too long/i.test(all)) {
      return { kind: 'validation', reason: 'السيرفر رفض قيمة غير صالحة: ' + all.slice(0, 200) };
    }
    return { kind: 'unknown', reason: all.slice(0, 250) || 'فشل الرفع — راجع العنصر مع الدكتور.' };
  },

  /** تنبيه ناعم (مش منع) لاقتراب حد الـ 20 كتابة يومياً بتوقيت القاهرة. */
  async warnBudget() {
    if (typeof Offline === 'undefined' || !Offline.encryption) return;
    try {
      const items = await Offline.all();
      const today = cairoDate(new Date().toISOString());
      const n = items.filter(x => x.payload && x.payload.origin === 'patient' &&
        x.payload.kind === 'rpc' && /^patient_portal_add/.test(String(x.payload.name || '')) &&
        cairoDate(x.createdAt) === today).length;
      if (n >= 18 && typeof toast === 'function') {
        toast('عندك ' + n + ' تسجيل مستني رفع، والسيرفر بيسمح بـ 20 كتابة/يوم — الأقدم ممكن يحتاج مراجعة الدكتور', 'info');
      }
    } catch (e) { Offline.log(e, 'offline.budget'); }
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
