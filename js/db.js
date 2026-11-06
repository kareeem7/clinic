/**
 * ========================================
 * db.js
 * الوظيفة: طبقة قاعدة البيانات الموحدة DB: تهيئة Supabase، المصادقة + 2FA الإلزامي، الجلب بالصفحات fetchAll، تحميل/إضافة/تعديل/حذف ناعم/استعادة، سجل التدقيق، بوابة الاشتراك، وحفظ الإعدادات عبر RPC.
 * الدوال/الكيانات الرئيسية: FIELD_MAPS، CHRONIC، DB، chronicChips، toRow، fromRow
 * الاعتمادات: config.js, utils.js, defaults.js (State تُقرأ وقت النداء من state.js)
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/db.js — طبقة قاعدة البيانات الموحّدة (Supabase)
   ------------------------------------------------------------
   واجهة واحدة async تعمل على Supabase (Postgres + Auth) عند
   توفر الإعدادات، أو على بيانات تجريبية محلية في وضع العرض.
   (القاعدة 8: عند التفعيل تُحفظ كل البيانات سحابياً فقط.)
   ============================================================ */

// خرائط تحويل أسماء الحقول: camelCase في الواجهة ↔ snake_case في قاعدة البيانات
const FIELD_MAPS = {
  patients: { targetWeight: 'target_weight', planId: 'plan_id', planStart: 'plan_start', planEnd: 'plan_end', createdAt: 'created_at', birthDate: 'birth_date', consentWa: 'consent_whatsapp', glucoseTrackingEnabled: 'glucose_tracking_enabled', bloodPressureTrackingEnabled: 'blood_pressure_tracking_enabled' },
  appointments: { patientId: 'patient_id', patientName: 'patient_name', cancelledAt: 'cancelled_at', cancelReason: 'cancel_reason' },
  plans: { desc: 'description' },
  patient_notes: { patientId: 'patient_id', sugarType: 'sugar_type', bpSys: 'bp_sys', bpDia: 'bp_dia', nextVisit: 'next_visit' },
  patient_labs: { patientId: 'patient_id', testName: 'test_name', testedOn: 'tested_on' },
  patient_health_readings: {
    patientId: 'patient_id', readingType: 'reading_type', recordedAt: 'recorded_at',
    glucoseValue: 'glucose_value', glucoseType: 'glucose_type', glucoseUnit: 'glucose_unit'
  },
  // doctor_id and patient_id are always assigned by DB methods, never caller payloads.
  patient_records: {
    patientId: 'patient_id', photoPath: 'photo_path', bodyFatMass: 'body_fat_mass',
    skeletalMuscleMass: 'skeletal_muscle_mass', visceralFatLevel: 'visceral_fat_level',
    bodyWaterPct: 'body_water_pct', recordType: 'record_type'
  }
};

// الدفعة ٣: الفروع مملوكة لنفس الدكتور؛ الفلترة للعرض فقط، والعزل الحقيقي
// من RLS + القيد المركّب (clinic_id, doctor_id). الصفوف بلا فرع تُعرض في النشط.
const clinicRows = rows => (typeof State !== 'undefined' && State.activeClinicId
  ? rows.filter(r => !r.clinic_id || r.clinic_id === State.activeClinicId)
  : rows);

/* ============================================================
   قائمة الأمراض المزمنة المدعومة في المتابعة
   ============================================================ */
const CHRONIC = {
  diabetes:     { label: 'السكري',          icon: 'fa-droplet',      cls: 'rose'   },
  hypertension: { label: 'ضغط الدم',        icon: 'fa-heart-pulse',  cls: 'violet' },
  heart:        { label: 'أمراض القلب',     icon: 'fa-heart',        cls: 'rose'   },
  thyroid:      { label: 'الغدة الدرقية',   icon: 'fa-shield-virus', cls: 'blue'   },
  cholesterol:  { label: 'الكوليسترول',     icon: 'fa-droplet',      cls: 'amber'  },
  arthritis:    { label: 'روماتيزم ومفاصل', icon: 'fa-bone',         cls: 'teal'   }
};
// رقائق الأمراض المزمنة للمريض
function chronicChips(p, small) {
  const list = Array.isArray(p.chronic) ? p.chronic : [];
  const known = list.filter(k => typeof k === 'string' && CHRONIC[k]).map(k =>
    '<span class="chip chip-' + CHRONIC[k].cls + '"><i class="fa-solid ' + CHRONIC[k].icon + '"></i>' +
    (small ? '' : ' ') + CHRONIC[k].label + '</span>');
  const custom = list.filter(x => x && typeof x === 'object' && !Array.isArray(x) &&
    typeof x.customCondition === 'string' && x.customCondition.trim()).map(x =>
    '<span class="chip chip-gray"><i class="fa-solid fa-notes-medical"></i>' +
    (small ? '' : ' ') + esc(x.customCondition.trim()) + '</span>');
  return known.concat(custom).join('');
}
// Validate structured lab components before they reach PostgREST. The database
// also enforces the JSON shape; errors intentionally contain no patient values.
function normalizeLabResults(results) {
  if (!Array.isArray(results) || results.length < 1 || results.length > 100) throw { code: 'invalid_lab_results' };
  return results.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw { code: 'invalid_lab_results' };
    if (typeof item.name !== 'string' || (item.unit != null && typeof item.unit !== 'string')) throw { code: 'invalid_lab_results' };
    const name = item.name.trim();
    const rawValue = item.value;
    const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    const unit = item.unit == null ? '' : item.unit.trim();
    if (!name || name.length > 100 || !(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) ||
        (typeof value === 'string' && (!value || value.length > 500)) || unit.length > 40) throw { code: 'invalid_lab_results' };
    return { name, value, ...(unit ? { unit } : {}) };
  });
}

function validateLabDate(date) {
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(date + 'T00:00:00Z') : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > todayISO()) {
    throw { code: 'invalid_lab_date' };
  }
  return date;
}

function normalizeHealthReadingTimestamp(value) {
  const source = value == null || value === '' ? new Date().toISOString() : value;
  if (typeof source !== 'string') throw { code: 'invalid_health_reading' };
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) throw { code: 'invalid_health_reading' };
  return date.toISOString();
}

function validateHealthReading(reading) {
  const type = reading && reading.readingType;
  const recordedAt = normalizeHealthReadingTimestamp(reading && reading.recordedAt);
  if (type === 'glucose') {
    const value = Number(reading.glucoseValue);
    if (!Number.isFinite(value) || value < 1 || value > 2000 ||
        !['fasting', 'post_meal', 'random'].includes(reading.glucoseType)) throw { code: 'invalid_health_reading' };
    return { readingType: type, glucoseValue: value, glucoseType: reading.glucoseType, glucoseUnit: 'mg/dL', recordedAt };
  }
  if (type === 'blood_pressure') {
    const systolic = Number(reading.systolic), diastolic = Number(reading.diastolic);
    const pulse = reading.pulse == null || reading.pulse === '' ? null : Number(reading.pulse);
    if (!Number.isInteger(systolic) || systolic < 1 || systolic > 400 ||
        !Number.isInteger(diastolic) || diastolic < 1 || diastolic > 300 ||
        (pulse !== null && (!Number.isInteger(pulse) || pulse < 1 || pulse > 400))) throw { code: 'invalid_health_reading' };
    return { readingType: type, systolic, diastolic, pulse, recordedAt };
  }
  throw { code: 'invalid_health_reading' };
}

function validateInBodyRecord(record) {
  const ranges = {
    weight: [20, 350], bmi: [1, 100], fat: [0, 100], bodyFatMass: [0, 500],
    skeletalMuscleMass: [0, 300], visceralFatLevel: [0, 100], bodyWaterPct: [0, 100]
  };
  const hasValue = Object.keys(ranges).some(key => record[key] != null && record[key] !== '');
  const date = record.date;
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(date + 'T00:00:00Z') : null;
  if (!hasValue || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > todayISO()) {
    throw { code: 'invalid_inbody_record' };
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = record[key];
    if (value == null || value === '') continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw { code: 'invalid_inbody_record' };
  }
}

// camelCase → snake_case قبل الإرسال لسوبابيز
function toRow(col, obj) {
  const map = FIELD_MAPS[col] || {}, out = {};
  for (const k in obj) out[map[k] || k] = obj[k];
  return out;
}
// snake_case → camelCase بعد الجلب من سوبابيز (مع إسقاط doctor_id غير اللازم للواجهة)
function fromRow(col, row) {
  const map = FIELD_MAPS[col] || {}, rev = {}, out = {};
  for (const k in map) rev[map[k]] = k;
  for (const k in row) { const c = rev[k] || k; if (c !== 'doctor_id') out[c] = row[k]; }
  return out;
}

/* ---- الدفعة ٢: بوابة اختيارية للأوفلاين -------------------------------
   لو offline.js / offline-capture.js مش محمّلين (اختبارات، صفحة reset)،
   المسار المباشر بيشتغل زي ما هو بالظبط من غير أي تغيير. */
function offlineCall(ops, live, fake) {
  if (typeof Offline === 'undefined' || typeof OfflineCapture === 'undefined') return live();
  return OfflineCapture.call(ops, live, fake);
}
function offlineId() {
  return (typeof OfflineCapture !== 'undefined') ? OfflineCapture.uuid() : null;
}
function offlineClinicId() {
  return (typeof State !== 'undefined' && State.activeClinicId) ? State.activeClinicId : null;
}

const DB = {
  uid: null, sb: null, ready: false, configError: null,

  // لازم عميل Supabase مضبوط: مفيش وضع ديمو ببيانات حقيقية.
  // بيانات المرضى أصلها السيرفر، والنسخة المؤقتة وقت انقطاع النت بتكون
  // في الدفتر المشفّر على جهاز المستخدم فقط (js/offline.js) — مش هنا ولا في الكاش.
  async init() {
    if (!SUPABASE_READY) {
      this.configError = 'setup-required';
      return false;
    }
    if (!window.supabase) {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      this.configError = offline
        ? 'النت مقطوع ونسخة مكتبة Supabase لسه مش محفوظة على هذا الجهاز — افتح الموقع مرة والنت شغّال، وبعدين هيفتح معاك أوفلاين'
        : 'تعذّر تحميل مكتبة Supabase من الشبكة — تحقق من الإنترنت أو من أدوات حظر الإعلانات ثم حدّث الصفحة';
      return false;
    }
    try {
      this.sb = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
      this.patientAuth = null; // initialized lazily as a non-persistent, isolated phone-OTP client
      this.ready = true;
      return true;
    } catch (e) {
      this.configError = (e && e.message) ? e.message : String(e);
      return false;
    }
  },

  // ---- Authentication (Supabase Auth + mandatory TOTP) ----
  // Returns the next required step so the UI can route the doctor:
  // 'mfa-verify' | 'mfa-enroll' | 'ready'
  async signIn(email, pass) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    this.uid = data.user.id;
    return this.mfaGate();
  },

  // Decide whether the session already satisfies the 2FA requirement
  async mfaGate() {
    const { data: aal, error } = await this.sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    if (aal.currentLevel === 'aal2') return 'ready'; // caller loads data explicitly — avoids double fetches
    // nextLevel aal2 means a verified TOTP factor exists and must be used now
    if (aal.nextLevel === 'aal2') return 'mfa-verify';
    return 'mfa-enroll'; // 2FA is mandatory for doctors: no factor yet
  },

  // Start TOTP enrollment: returns the QR (SVG data URI) and the manual secret
  async mfaEnroll() {
    const { data, error } = await this.sb.auth.mfa.enroll({ factorType: 'totp' });
    if (error) throw error;
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  },

  // Verify a 6-digit code, either to finish enrollment or to raise the session to aal2
  async mfaVerify(code, factorId) {
    let fid = factorId;
    if (!fid) {
      const { data, error } = await this.sb.auth.mfa.listFactors();
      if (error) throw error;
      const totp = (data && data.totp || []).find(f => f.status === 'verified')
        || (data && data.totp || [])[0];
      if (!totp || !totp.id) throw { code: 'mfa_no_factor' };
      fid = totp.id;
    }
    const ch = await this.sb.auth.mfa.challenge({ factorId: fid });
    if (ch.error) throw ch.error;
    // GoTrue قد يُرجع data:null بلا error عند انتهاء الجلسة أو إلغاء الطلب.
    // قراءة ch.data.id مباشرة كانت ترمي TypeError → «حدث خطأ غير متوقع».
    if (!ch.data || !ch.data.id) throw { code: 'session_not_found' };
    const vr = await this.sb.auth.mfa.verify({ factorId: fid, challengeId: ch.data.id, code });
    if (vr.error) throw vr.error;
    return 'ready'; // caller decides the next screen (doctor loads data, admin doesn't)
  },

  // RLS self-check: only a user present in superadmins may enter the admin console
  async isSuperAdmin() {
    const { data } = await this.sb.from('superadmins').select('id').eq('id', this.uid).maybeSingle();
    return Boolean(data);
  },

  // Subscription gate: suspended / deleted / expired clinics cannot open the app
  assertActive() {
    const acc = (State.settings && State.settings.account) || {};
    if (acc.status === 'suspended') throw { code: 'account_suspended' };
    if (acc.status === 'deleted') throw { code: 'account_deleted' };
    if (acc.status === 'active' && acc.endsAt && acc.endsAt < todayISO()) throw { code: 'account_expired' };
    if (acc.status === 'trial' && acc.endsAt && acc.endsAt < todayISO()) throw { code: 'account_expired' };
  },
  // إنشاء حساب دكتور جديد — ويحفظ بياناته (الاسم، التخصص، العيادة) في جدول doctors
  // Create a doctor account and its clinic profile row
  async register(name, spec, clinic, email, pass) {
    const { data, error } = await this.sb.auth.signUp({
      email, password: pass,
      options: { data: { doctor_name: name, specialty: spec, clinic_name: clinic } }
    });
    if (error) throw error;
    // When "Confirm email" is enabled there is no immediate session, so the
    // doctors/clinics rows cannot be written yet (RLS needs auth.uid()). The
    // first successful sign-in heals them via ensureDoctorProfile() below.
    if (!data.session) throw { code: 'confirm-email' };
    this.uid = data.user.id;
    const s0 = defaultClinicData().settings;
    // A new profile is inserted before MFA enrollment; reads and updates require AAL2.
    const { error: sErr } = await this.sb.from('doctors').insert({
      id: this.uid,
      settings: {
        ...s0, doctorName: name, specialty: spec, clinicName: clinic || ('عيادة ' + name),
        // Every new clinic starts on a free trial — its expiry is enforced at login
        account: { status: 'trial', endsAt: addDaysISO(todayISO(), TRIAL_DAYS) }
      }
    });
    if (sErr) throw sErr;
    // الدفعة ٣: فرع افتراضي واحد، بلا بادئة لحد ما الدكتور يختارها من الإعدادات
    const { error: cErr } = await this.sb.from('clinics').insert({
      doctor_id: this.uid, name: clinic || ('عيادة ' + name), is_default: true
    });
    if (cErr) throw cErr;
    return 'mfa-enroll'; // 2FA enrollment is mandatory before reaching the app
  },

  async signOut() {
    this.uid = null;
    resetClinicalState();
    await this.sb.auth.signOut();
  },

  async resetPassword(email) {
    // The recovery link must land on the dedicated reset.html page, not on the
    // app shell: index.html boots the MFA gate and would swallow an aal1
    // recovery session instead of letting the doctor set a new password.
    const redirectTo = new URL('reset.html', location.origin + location.pathname).href;
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    if (error) throw error;
  },

  /* ---- Append-only audit trail (never contains PHI) ---- */
  async audit(action, entity, entityId, meta) {
    if (!this.uid) return;
    // الأوفلاين: سطر التدقيق بيتسجّل وقت الرفع من OfflineCapture.auditReplay
    if (typeof Offline !== 'undefined' && !Offline.isOnline) return;
    const row = {
      actor_id: this.uid, action, entity, entity_id: entityId || null,
      meta: { requestId: newRequestId(), ...(meta || {}) }
    };
    // Audit failures must never block clinical work; they are reported, not thrown
    const { error } = await this.sb.from('audit_logs').insert(row);
    if (error) logError(error, 'audit.' + action);
  },

  // Read the doctor's own audit trail (newest first) for the archive/compliance view
  async readAudit(limit) {
    const { data, error } = await this.sb.from('audit_logs')
      .select('*').order('created_at', { ascending: false }).limit(limit || 200);
    if (error) throw error;
    return data || [];
  },

  // تحميل صف إعدادات العيادة وحده (doctors.settings) — يكفي لفحص بوابة
  // الاشتراك قبل سحب أي بيانات مرضى للذاكرة. جدول doctors مقصود ألا يكون
  // مقفولاً بـclinic_active في RLS حتى والدكتور الموقوف يقدر يقرأ سبب إيقافه.
  async loadSettingsRow() {
    const docRow = await this.readDoctorSettings();
    State.settings = normalizeClinicSettings(docRow.settings);
    return State.settings;
  },

  /* Self-healing read: a confirmed signup may have no doctors row when
     "Confirm email" was enabled at registration time (signUp returns no
     session, so register() cannot insert under RLS). Recreate it once, from
     the Auth user's own metadata, before any clinical data is loaded. */
  async readDoctorSettings() {
    const read = () => this.sb.from('doctors').select('settings').eq('id', this.uid).maybeSingle();
    let { data: docRow, error } = await read();
    if (error) throw error;
    if (!docRow) {
      await this.ensureDoctorProfile();
      ({ data: docRow, error } = await read());
      if (error) throw error;
    }
    if (!docRow) throw { code: 'clinic_profile_missing' };
    return docRow;
  },

  /* Idempotent: never overwrites an existing profile (no trial/subscription
     reset). RLS doctors_own allows INSERT for auth.uid() = id; clinics_own
     allows it once clinic_active() sees the freshly created doctors row. */
  async ensureDoctorProfile() {
    const { data, error } = await this.sb.auth.getUser();
    if (error) throw error;
    const user = data && data.user;
    if (!user || user.id !== this.uid) throw { code: 'clinic_profile_missing' };
    const meta = user.user_metadata || {};
    const name = String(meta.doctor_name || '').trim();
    const spec = String(meta.specialty || '').trim();
    const clinicName = String(meta.clinic_name || '').trim() || (name ? 'عيادة ' + name : '');
    const s0 = defaultClinicData().settings;
    const settings = {
      ...s0, doctorName: name, specialty: spec, clinicName,
      account: { status: 'trial', endsAt: addDaysISO(todayISO(), TRIAL_DAYS) }
    };
    // ON CONFLICT DO NOTHING → existing settings (including suspension) survive
    const { error: dErr } = await this.sb.from('doctors')
      .upsert({ id: this.uid, settings }, { onConflict: 'id', ignoreDuplicates: true });
    if (dErr) throw dErr;
    const { data: branches, error: cErr } = await this.sb.from('clinics')
      .select('id').eq('doctor_id', this.uid).is('deleted_at', null).limit(1);
    if (cErr) throw cErr;
    if (!branches || !branches.length) {
      const { error: iErr } = await this.sb.from('clinics')
        .insert({ doctor_id: this.uid, name: clinicName, is_default: true });
      if (iErr) throw iErr;
    }
    return settings;
  },

  // (متوسط 1) جلب كل الصفوف على صفحات: PostgREST افتراضياً بيرجع أول 1000 صف
  // بس (db-max-rows)، وأي جدول أكبر كان بيتقص بصمت وقت التحميل — قياسات
  // تختفي من غير أي خطأ. الحلقة بتكمل لحد صفحة فاضية، بترتيب ثابت يحدده
  // المستدعي (order) عشان الصفحات ما تتداخلش، مع حمايتين: لو السيرفر تجاهل
  // الـrange (أول صف اتكرر) بيرمي خطأ صريح، وسقف صارم ضد الدوران اللانهائي.
  async fetchAll(build) {
    const pageSize = 1000;
    let from = 0, out = [], prevFirst = null;
    for (;;) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) break;
      const first = JSON.stringify(rows[0]);
      if (first === prevFirst) throw { code: 'pagination_stuck', message: 'السيرفر تجاهل ترقيم الصفحات — راجع إعداد db-max-rows في Supabase' };
      prevFirst = first;
      out = out.concat(rows);
      from += rows.length;
      if (from > 500000) throw { code: 'pagination_overflow', message: 'عدد الصفوف أكبر من أي حجم عيادة معقول — افحص البيانات' };
    }
    return out;
  },

  // تحميل كل بيانات العيادة مرة واحدة بعد الدخول (RLS يعيد بيانات هذا الدكتور فقط)
  async loadAll() {
    {
      // Defence in depth: explicit doctor filter on top of server-side RLS,
      // plus soft-delete filter so archived rows never reach the normal UI.
      // (بند 31) ما نشفطش كل القاعدة في كل تسجيل دخول:
      //   المرضى → فهرس خفيف (loadRoster) والقائمة الكاملة صفحة-بصفحة من السيرفر (pagePatients)
      //   المواعيد → نافذة زمنية ±730 يوم حول اليوم بدل كل التاريخ
      //   القياسات والملاحظات → عند الطلب لكل مريض (loadRecords / loadNotesFor)
      // (متوسط 1) order بمفتاح ثابت (id) عشان الصفحات ما تتداخلش، والجلب
      // عبر fetchAll — الجداول فوق 1000 صف ما بتتقصش تاني
      const winFrom = addDaysISO(todayISO(), -730), winTo = addDaysISO(todayISO(), 730);
      const grab = async (t) => {
        const rows = await this.fetchAll(() => this.sb.from(t).select('*')
          .eq('doctor_id', this.uid).is('deleted_at', null).order('id'));
        return rows.map(r => fromRow(t, r));
      };
      const grabAppts = async () => {
        const rows = await this.fetchAll(() => this.sb.from('appointments').select('*')
          .eq('doctor_id', this.uid).is('deleted_at', null)
          .gte('date', winFrom).lte('date', winTo)
          .order('date').order('id'));
        return rows.map(r => fromRow('appointments', r));
      };
      const [roster, appointments, plans] = await Promise.all([
        this.loadRoster(), grabAppts(), grab('plans')
      ]);
      const docRow = await this.readDoctorSettings();
      State.appointments = clinicRows(appointments);
      State.settings = normalizeClinicSettings(docRow.settings);
      State.healthAlerts = await this.loadRecentHealthAlerts();
      State.pTotal = clinicRows(roster).filter(p => p.status === 'active').length;
      if (plans.length) { State.plans = clinicRows(plans); }
      else {
        // First sign-in: seed the starter nutrition-plan library for this doctor
        const seedRows = defaultClinicData().plans.map(pl => ({
          doctor_id: this.uid, title: pl.title, calories: pl.calories, description: pl.desc,
          duration: pl.duration, notes: pl.notes, meals: pl.meals,
          contraindications: pl.contraindications || null
        }));
        const { data: inserted, error } = await this.sb.from('plans').insert(seedRows).select();
        if (error) throw error;
        State.plans = clinicRows((inserted || []).map(r => fromRow('plans', r)));
      }
    }
    State.loaded = true;
    // نسخة مشفّرة للقراءة فقط على جهاز العيادة، تتجدّد بعد كل تحميل ناجح.
    // الفشل هنا ما يوقفش الدخول أبداً.
    if (typeof OfflineSnapshot !== 'undefined' && typeof OfflineSnapshot.saveDoctor === 'function') {
      OfflineSnapshot.saveDoctor(State, this.uid).catch(() => {});
    }
    // Audit the bulk read without any PHI: counts only
    this.audit('view', 'patients', null, { scope: 'list', count: Object.keys(State.patientIndex).length });
  },

  // الدفعة ٣: قائمة فروع الدكتور + الفرع النشط (محفوظ في doctors.settings)
  async loadClinics() {
    const rows = await this.fetchAll(() => this.sb.from('clinics')
      .select('id,name,code,phone,is_default,active')
      .eq('doctor_id', this.uid).is('deleted_at', null)
      .order('is_default', { ascending: false }).order('name'));
    State.clinics = rows;
    const saved = State.settings && State.settings.activeClinicId;
    State.activeClinicId = rows.some(c => c.id === saved) ? saved
      : ((rows.find(c => c.is_default) || rows[0] || {}).id || null);
    // ترايجر set_row_clinic_id بيقرأ doctors.settings مباشرة، فلازم نثبّت
    // الاختيار على السيرفر قبل أول INSERT (خصوصاً أول دخول لحساب جديد).
    // save_clinic_settings RPC موجودة أصلاً وتحافظ على حقل account.
    if (State.activeClinicId && (!State.settings || !State.settings.activeClinicId)) {
      try {
        const { error } = await this.sb.rpc('save_clinic_settings', { patch: { activeClinicId: State.activeClinicId } });
        if (!error && State.settings) State.settings.activeClinicId = State.activeClinicId;
      } catch (e) { /* best-effort: الفلترة في الذاكرة بتشتغل على أي حال */ }
    }
    return State.clinics;
  },

  // Keep unacknowledged safety-threshold readings visible on the doctor dashboard
  // for 24 hours. This is an in-app notice, not a push/emergency service.
  async loadRecentHealthAlerts() {
    const features = normalizeClinicalFeatures((State.settings || {}).clinicalFeatures);
    if (!features.glucoseTracking && !features.bloodPressureTracking) return [];
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.fetchAll(() => {
      let q = this.sb.from('patient_health_readings')
        .select('id,patient_id,reading_type,recorded_at,glucose_value,glucose_unit,glucose_type,systolic,diastolic,pulse,source,clinic_id')
        .eq('doctor_id', this.uid).is('deleted_at', null).gte('recorded_at', since)
        .or('and(reading_type.eq.glucose,glucose_value.lt.70),and(reading_type.eq.blood_pressure,systolic.gt.180),and(reading_type.eq.blood_pressure,diastolic.gt.120)');
      if (State.activeClinicId) q = q.eq('clinic_id', State.activeClinicId);
      return q.order('recorded_at', { ascending: false }).order('id');
    });
    const alerts = rows.map(r => fromRow('patient_health_readings', r))
      .map(reading => ({ reading, alert: healthReadingAlert(reading) }))
      .filter(item => item.alert)
      .map(item => ({ ...item.reading, alertLevel: item.alert.level, alertLabel: item.alert.label }));
    await this.audit('view', 'patient_health_readings', null, { scope: 'safety-alerts', count: alerts.length });
    return alerts;
  },

  // Load soft-deleted rows for the archive view (separate query, audited)
  async loadArchive(table) {
    // (متوسط 1) paginated + مفتاح ترتيب تاني (id) يستقر مع تساوي التوقيتات
    const data = await this.fetchAll(() => this.sb.from(table).select('*')
      .eq('doctor_id', this.uid).not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }).order('id'));
    await this.audit('view', table, null, { scope: 'archive', count: data.length });
    return clinicRows(data).map(r => fromRow(table, r));
  },

  // (بند 12) المريض + قياساته الأولى بيتسجلوا في معاملة واحدة ذرّية عبر RPC:
  // يا إما كله نجح يا إما مفيش حاجة اتسجلت — مفيش مريض يتيم ولا تكرار
  async add(col, data) {
    if (col === 'patients' && Array.isArray(data.measurements) && data.measurements.length) {
      const rpcArgs = {
        p_patient: {
          name: data.name, phone: data.phone, age: data.age ?? null, gender: data.gender || null,
          type: data.type, status: data.status || 'active', height: data.height ?? null,
          targetWeight: data.targetWeight ?? null, planId: data.planId || null,
          planStart: data.planStart || null, planEnd: data.planEnd || null,
          diagnosis: data.diagnosis || null, notes: data.notes || null, chronic: data.chronic || [],
          birthDate: data.birthDate || null, consentWa: data.consentWa || false
        },
        p_measurements: data.measurements.map(m => ({
          date: m.date || todayISO(), height: m.height ?? null, weight: m.weight ?? null,
          waist: m.waist ?? null, hips: m.hips ?? null, arm: m.arm ?? null, bmi: m.bmi ?? null,
          session: m.session ?? null, pain: m.pain ?? null, note: m.note || '', recordType: m.recordType || 'manual'
        }))
      };
      const offlineReady = typeof Offline !== 'undefined' && typeof OfflineCapture !== 'undefined';
      let r, error;
      if (offlineReady) {
        // الـ RPC بيولّد id جوه Postgres؛ الأوفلاين بنولّده إحنا على الجهاز مرة واحدة
        // عشان القياسات المرتبطة بيه ما تتوهش بعد الرفع.
        const fb = OfflineCapture.patientInsertOps(data, this.uid, offlineClinicId());
        const resp = await OfflineCapture.call(fb.ops,
          () => this.sb.rpc('create_patient_with_measurements', rpcArgs),
          { data: { ok: true, patientId: fb.id, records: [] }, error: null });
        r = resp.data; error = resp.error;
      } else {
        const resp = await this.sb.rpc('create_patient_with_measurements', rpcArgs);
        r = resp.data; error = resp.error;
      }
      if (error) throw error;
      if (!r || !r.ok) throw { message: 'تعذّر تسجيل المريض' };
      data.id = r.patientId;
      (r.records || []).forEach((x, i) => { if (data.measurements[i]) data.measurements[i].id = x.id; });
      State.patients.push(data);
      if (data.id) State.patientIndex[data.id] = data; // (بند 31)
      await this.audit('create', 'patients', data.id, { withMeasurements: data.measurements.length });
      return data;
    }
    const row = toRow(col, data);
    delete row.id;           // id is generated by Postgres (أوفلاين: من الجهاز)
    delete row.measurements; // القياسات تُحفظ في جدول patient_records المستقل
    row.doctor_id = this.uid; // عزل البيانات بالدكتور الحالي
    const oid = offlineId();
    if (oid) row.id = oid;   // UUID ثابت بين الدفتر والسيرفر
    const { data: rows, error } = await offlineCall(
      { kind: 'insert', table: col, row, label: 'إضافة ' + col, clinicId: offlineClinicId() },
      () => this.sb.from(col).insert(row).select(),
      { data: [row], error: null });
    if (error) throw error;
    data.id = rows[0].id;
    State[col].push(data);
    if (col === 'patients' && data.id) State.patientIndex[data.id] = data; // (بند 31)
    await this.audit('create', col, data.id);
    return data;
  },

  // (بند 12) الذاكرة بتتحدث بعد نجاح السيرفر فقط — لو الطلب فشل الشاشة
  // ما تكذبش وتوري تعديل مش موجود فعلياً في قاعدة البيانات
  async update(col, id, patch) {
    const row = toRow(col, patch);
    delete row.id; delete row.measurements; delete row._recordsLoaded;
    // Scope the write by doctor_id as well: a stray id can never touch another tenant
    const { error } = await offlineCall(
      { kind: 'update', table: col, row, label: 'تعديل ' + col, clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'doctor_id', op: 'eq', val: this.uid }] },
      () => this.sb.from(col).update(row).eq('id', id).eq('doctor_id', this.uid),
      { data: null, error: null });
    if (error) throw error;
    const i = State[col].findIndex(x => x.id === id);
    if (i > -1) Object.assign(State[col][i], patch);
    // (بند 31) الفهرس الخفيف يتحدث مع أي تعديل — قد يكون كائناً مختلفاً عن صف القائمة
    if (col === 'patients' && State.patientIndex[id]) Object.assign(State.patientIndex[id], patch);
    await this.audit('edit', col, id, { fields: Object.keys(patch).length });
  },

  // Clinical data is never hard-deleted: mark the row and hide it from the UI
  // (بند 12) الإخفاء من الذاكرة بعد تأكيد السيرفر — فشل الطلب ما يخفيش الصف
  async remove(col, id) {
    const delRow = { deleted_at: new Date().toISOString(), deleted_by: this.uid };
    const { error } = await offlineCall(
      { kind: 'update', table: col, row: delRow, label: 'أرشفة ' + col, clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'doctor_id', op: 'eq', val: this.uid }] },
      () => this.sb.from(col).update(delRow).eq('id', id).eq('doctor_id', this.uid),
      { data: null, error: null });
    if (error) throw error;
    State[col] = State[col].filter(x => x.id !== id);
    if (col === 'patients') delete State.patientIndex[id]; // (بند 31)
    await this.audit('delete', col, id, { soft: true });
  },

  // Bring a soft-deleted row back from the archive
  async restore(col, id) {
    const row = { deleted_at: null, deleted_by: null };
    const { error } = await offlineCall(
      { kind: 'update', table: col, row, label: 'استعادة من الأرشيف', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'doctor_id', op: 'eq', val: this.uid }] },
      () => this.sb.from(col).update(row).eq('id', id).eq('doctor_id', this.uid),
      { data: null, error: null });
    if (error) throw error;
    await this.audit('restore', col, id);
    // loadAll محتاج سيرفر؛ أوفلاين بنسيب الطلب في الدفتر والشاشة هتتحدّث بعد الرفع
    if (typeof Offline !== 'undefined' && !Offline.isOnline) {
      if (typeof toast === 'function') toast('طلب الاستعادة اتحفظ على الجهاز وهيظهر بعد ما النت يرجع', 'info');
      return;
    }
    await this.loadAll();
  },

  // حفظ إعدادات العيادة — عبر RPC في السيرفر (save_clinic_settings):
  // 'account' (حالة الاشتراك) مستثناة هنا وفي السيرفر معاً، فنسخة قديمة
  // في الذاكرة مستحيل تكتب فوق تعليق/إنهاء عمله الأدمن. الدمج في السيرفر
  // shallow-merge على settings الحالية بدل استبدالها كاملة.
  async saveSettings(s) {
    const current = State.settings || {};
    const input = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
    const { account, ...clinicInput } = input; // account أدمن فقط (trigger guard_account)
    const featureInput = Object.prototype.hasOwnProperty.call(clinicInput, 'clinicalFeatures')
      ? clinicInput.clinicalFeatures : current.clinicalFeatures;
    const clinic = { ...clinicInput, clinicalFeatures: normalizeClinicalFeatures(featureInput) };
    const nextSettings = { ...current, ...clinic };
    // Commit the local state only after the server accepts the clinic-scoped patch.
    // الدفعة ٣: الإعدادات shallow-merge على السيرفر، فإعادة الرفع آمنة نسبياً،
    // لكن لو دكتور تاني غيّر نفس المفتاح وقت الأوفلاين هيظهر تعارض للمراجعة.
    const { error } = await offlineCall(
      { kind: 'rpc', name: 'save_clinic_settings', args: { patch: clinic },
        label: 'إعدادات العيادة', clinicId: offlineClinicId() },
      () => this.sb.rpc('save_clinic_settings', { patch: clinic }),
      { data: null, error: null });
    if (error) throw error;
    State.settings = nextSettings;
    await this.audit('edit', 'doctors', this.uid, { scope: 'settings' });
  },
  // ===== ملاحظات الزيارات ومتابعة الأمراض المزمنة (جدول patient_notes) =====
  async addNote(rec) {
    const row = toRow('patient_notes', rec);
    delete row.id; row.doctor_id = this.uid;
    const oid = offlineId(); if (oid) row.id = oid;
    const { data, error } = await offlineCall(
      { kind: 'insert', table: 'patient_notes', row, label: 'ملاحظة زيارة', clinicId: offlineClinicId() },
      () => this.sb.from('patient_notes').insert(row).select(),
      { data: [row], error: null });
    if (error) throw error;
    rec.id = data[0].id;
    State.notes.push(rec);
    await this.audit('create', 'patient_notes', rec.id, { patientRef: true });
    return rec;
  },

  // Soft delete: the visit note stays in the archive for the legal retention period
  async deleteNote(id) {
    State.notes = State.notes.filter(n => n.id !== id);
    const delRow = { deleted_at: new Date().toISOString(), deleted_by: this.uid };
    const { error } = await offlineCall(
      { kind: 'update', table: 'patient_notes', row: delRow, label: 'حذف ملاحظة', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'doctor_id', op: 'eq', val: this.uid }] },
      () => this.sb.from('patient_notes').update(delRow).eq('id', id).eq('doctor_id', this.uid),
      { data: null, error: null });
    if (error) throw error;
    await this.audit('delete', 'patient_notes', id, { soft: true });
  },

  // ===== Clinical records (doctor-side CRUD; portal writes remain RPC-only) =====
  async loadLabs(pid) {
    const rows = await this.fetchAll(() => this.sb.from('patient_labs').select('*')
      .eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
      .order('tested_on', { ascending: false }).order('id'));
    const labs = rows.map(r => fromRow('patient_labs', r));
    await this.audit('view', 'patient_labs', null, { patientRef: true, count: labs.length });
    return labs;
  },

  async addLab(pid, lab) {
    const testName = lab && typeof lab.testName === 'string' ? lab.testName.trim() : '';
    if (!testName || testName.length > 160) throw { code: 'invalid_lab_test_name' };
    const row = {
      doctor_id: this.uid, patient_id: pid, test_name: testName,
      tested_on: validateLabDate(lab.testedOn || todayISO()), results: normalizeLabResults(lab.results || []), source: 'clinic'
    };
    const oid = offlineId(); if (oid) row.id = oid;
    const { data, error } = await offlineCall(
      { kind: 'insert', table: 'patient_labs', row, label: 'تحليل معملي', clinicId: offlineClinicId() },
      () => this.sb.from('patient_labs').insert(row).select().single(),
      { data: row, error: null });
    if (error) throw error;
    const saved = fromRow('patient_labs', data);
    await this.audit('create', 'patient_labs', saved.id, { patientRef: true });
    return saved;
  },

  async updateLab(pid, id, patch) {
    const row = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'testName')) {
      row.test_name = typeof patch.testName === 'string' ? patch.testName.trim() : '';
      if (!row.test_name || row.test_name.length > 160) throw { code: 'invalid_lab_test_name' };
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'testedOn')) row.tested_on = validateLabDate(patch.testedOn);
    if (Object.prototype.hasOwnProperty.call(patch, 'results')) row.results = normalizeLabResults(patch.results);
    if (!Object.keys(row).length) throw { code: 'empty_update' };
    const fakeRow = Object.assign({ id, patient_id: pid, doctor_id: this.uid, deleted_at: null }, row);
    const { data, error } = await offlineCall(
      { kind: 'update', table: 'patient_labs', row, label: 'تعديل تحليل', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'patient_id', op: 'eq', val: pid },
          { col: 'doctor_id', op: 'eq', val: this.uid }, { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patient_labs').update(row)
        .eq('id', id).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
        .select().maybeSingle(),
      { data: fakeRow, error: null });
    if (error) throw error;
    if (!data) throw { code: 'clinical_record_not_found' };
    const saved = fromRow('patient_labs', data);
    await this.audit('edit', 'patient_labs', id, { patientRef: true });
    return saved;
  },

  async deleteLab(pid, id) {
    const delRow = { deleted_at: new Date().toISOString(), deleted_by: this.uid };
    const { data, error } = await offlineCall(
      { kind: 'update', table: 'patient_labs', row: delRow, label: 'حذف تحليل', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'patient_id', op: 'eq', val: pid },
          { col: 'doctor_id', op: 'eq', val: this.uid }, { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patient_labs').update(delRow)
        .eq('id', id).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
        .select('id').maybeSingle(),
      { data: { id }, error: null });
    if (error) throw error;
    if (!data) throw { code: 'clinical_record_not_found' };
    await this.audit('delete', 'patient_labs', id, { soft: true, patientRef: true });
  },

  async updatePatientMonitoring(pid, patch) {
    const allowed = ['glucoseTrackingEnabled', 'bloodPressureTrackingEnabled'];
    const safe = {};
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(patch || {}, key)) continue;
      if (typeof patch[key] !== 'boolean') throw { code: 'invalid_monitoring_setting' };
      safe[key] = patch[key];
    }
    if (!Object.keys(safe).length) throw { code: 'empty_update' };
    const row = toRow('patients', safe);
    const fakeRow = Object.assign({ id: pid }, row);
    const { data, error } = await offlineCall(
      { kind: 'update', table: 'patients', row, label: 'إعدادات متابعة', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: pid }, { col: 'doctor_id', op: 'eq', val: this.uid },
          { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patients').update(row)
        .eq('id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
        .select('id,glucose_tracking_enabled,blood_pressure_tracking_enabled').maybeSingle(),
      { data: fakeRow, error: null });
    if (error) throw error;
    if (!data) throw { code: 'patient_not_found' };
    const saved = fromRow('patients', data);
    const patient = typeof getPatient === 'function' ? getPatient(pid) : null;
    if (patient) Object.assign(patient, saved);
    if (typeof State !== 'undefined' && State.patientIndex && State.patientIndex[pid]) Object.assign(State.patientIndex[pid], saved);
    await this.audit('edit', 'patients', pid, { scope: 'health_monitoring', fields: Object.keys(safe).length });
    return saved;
  },

  async loadHealthReadings(pid, readingType) {
    const rows = await this.fetchAll(() => {
      let q = this.sb.from('patient_health_readings').select('*')
        .eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null);
      if (readingType) q = q.eq('reading_type', readingType);
      return q.order('recorded_at', { ascending: false }).order('id');
    });
    const readings = rows.map(r => fromRow('patient_health_readings', r));
    await this.audit('view', 'patient_health_readings', null, { patientRef: true, count: readings.length });
    return readings;
  },

  async addHealthReading(pid, reading) {
    const normalized = validateHealthReading(reading);
    const row = toRow('patient_health_readings', normalized);
    row.doctor_id = this.uid; row.patient_id = pid; row.source = 'clinic';
    const oid = offlineId(); if (oid) row.id = oid;
    const { data, error } = await offlineCall(
      { kind: 'insert', table: 'patient_health_readings', row, label: 'قراءة سكر/ضغط', clinicId: offlineClinicId() },
      () => this.sb.from('patient_health_readings').insert(row).select().single(),
      { data: row, error: null });
    if (error) throw error;
    const saved = fromRow('patient_health_readings', data);
    await this.audit('create', 'patient_health_readings', saved.id, { patientRef: true });
    return saved;
  },

  async updateHealthReading(pid, id, patch) {
    const allowed = ['readingType', 'recordedAt', 'glucoseValue', 'glucoseType', 'systolic', 'diastolic', 'pulse'];
    const safePatch = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) safePatch[key] = patch[key];
    if (!Object.keys(safePatch).length) throw { code: 'empty_update' };
    // الدفعة ٣: الميثود دي لازم تقرأ الصف الحالي من السيرفر قبل التعديل عشان
    // validateHealthReading. مش هنخزّن تعديل سريري غير متحقّق منه، فبنأجّل
    // **العملية كلها** (kind: method) ووقت الرفع بتتنفّذ كاملة على السيرفر؛
    // لو التحقق فشل ساعتها بيظهر تعارض للدكتور بدل ما يتكتب بيانات غلط.
    return offlineCall(
      { kind: 'method', method: 'updateHealthReading', args: [pid, id, safePatch],
        label: 'تعديل قراءة سكر/ضغط', clinicId: offlineClinicId() },
      async () => {
        const { data: current, error: readError } = await this.sb.from('patient_health_readings').select('*')
          .eq('id', id).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null).maybeSingle();
        if (readError) throw readError;
        if (!current) throw { code: 'clinical_record_not_found' };
        const normalized = validateHealthReading({ ...fromRow('patient_health_readings', current), ...safePatch });
        const row = toRow('patient_health_readings', normalized);
        const { data, error } = await this.sb.from('patient_health_readings').update(row)
          .eq('id', id).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
          .select().maybeSingle();
        if (error) throw error;
        if (!data) throw { code: 'clinical_record_not_found' };
        const saved = fromRow('patient_health_readings', data);
        await this.audit('edit', 'patient_health_readings', id, { patientRef: true });
        return saved;
      },
      Object.assign({ id }, safePatch) // تفاؤلي للواجهة فقط، والتحقق الحقيقي وقت الرفع
    );
  },

  async deleteHealthReading(pid, id) {
    const delRow = { deleted_at: new Date().toISOString(), deleted_by: this.uid };
    const { data, error } = await offlineCall(
      { kind: 'update', table: 'patient_health_readings', row: delRow, label: 'حذف قراءة', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: id }, { col: 'patient_id', op: 'eq', val: pid },
          { col: 'doctor_id', op: 'eq', val: this.uid }, { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patient_health_readings').update(delRow)
        .eq('id', id).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
        .select('id').maybeSingle(),
      { data: { id }, error: null });
    if (error) throw error;
    if (!data) throw { code: 'clinical_record_not_found' };
    await this.audit('delete', 'patient_health_readings', id, { soft: true, patientRef: true });
  },

  // ===== سجل القياسات: جدول patient_records حقيقي في Postgres =====
  // (حذف المريض يحذف قياساته تلقائياً عبر on delete cascade)
  // ===== (بند 31) تحميل رشيق: فهرس خفيف + ترقيم من السيرفر + استعلامات مستهدفة =====
  // فهرس خفيف لكل المرضى (أعمدة أساسية فقط): يحسم الأسماء والمراجع والعدّادات
  // من غير تحميل الصفوف الكاملة — القائمة نفسها بتيجي صفحة-بصفحة من pagePatients
  async loadRoster() {
    const rows = await this.fetchAll(() => {
      let q = this.sb.from('patients')
        .select('id,name,phone,type,status,created_at,plan_id,diagnosis,clinic_id')
        .eq('doctor_id', this.uid).is('deleted_at', null);
      if (State.activeClinicId) q = q.eq('clinic_id', State.activeClinicId);
      return q.order('id');
    });
    const ps = rows.map(r => fromRow('patients', r));
    ps.forEach(p => { State.patientIndex[p.id] = p; });
    return ps;
  },
  // بانى استعلام قائمة المرضى (بحث + فلتر تخصص) — يُستخدم للصفوف وللعدّ معاً
  _pfQuery(q, type, selectOptions) {
    let b = this.sb.from('patients').select('*', selectOptions)
      .eq('doctor_id', this.uid).is('deleted_at', null).eq('status', 'active');
    if (State.activeClinicId) b = b.eq('clinic_id', State.activeClinicId);
    if (type && type !== 'all') b = b.eq('type', type);
    const s = String(q || '').replace(/[%(),]/g, ' ').trim();
    if (s) {
      const d = s.replace(/\D/g, '');
      b = b.or((d && d === s)
        ? 'phone.ilike.%' + d + '%,name.ilike.%' + s + '%'
        : 'name.ilike.%' + s + '%');
    }
    return b;
  },
  // صفحة مرضى من السيرفر + إجمالي المطابقين (للترقيم) — الصفوف الكاملة تُخزّن في الفهرس
  async pagePatients(opts) {
    const per = opts.per || 10, page = Math.max(1, opts.page || 1);
    const { data, error } = await this._pfQuery(opts.q, opts.type)
      .order('name').order('id')
      .range((page - 1) * per, page * per - 1);
    if (error) throw error;
    const { count, error: e2 } = await this._pfQuery(opts.q, opts.type, { count: 'exact', head: true });
    if (e2) throw e2;
    const rows = (data || []).map(r => {
      const p = fromRow('patients', r); p._full = true;
      State.patientIndex[p.id] = p;
      return p;
    });
    return { rows, total: count || 0 };
  },
  // صف مريض كامل عند فتح الملف/التعديل من سياق يملك الفهرس الخفيف فقط
  async loadPatientFull(id) {
    const { data, error } = await this.sb.from('patients').select('*')
      .eq('id', id).eq('doctor_id', this.uid).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const p = fromRow('patients', data); p._full = true;
    State.patientIndex[p.id] = p;
    const i = State.patients.findIndex(x => x.id === id);
    if (i > -1) State.patients[i] = p;
    return p;
  },
  // قياسات مجموعة مرضى (صفحة القائمة الحالية) دفعة واحدة لعمود «آخر متابعة»
  async loadRecordsFor(pids) {
    const ids = [...new Set((pids || []).filter(Boolean))];
    if (!ids.length) return;
    const rows = await this.fetchAll(() => this.sb.from('patient_records').select('*')
      .in('patient_id', ids).eq('doctor_id', this.uid).is('deleted_at', null)
      .order('date').order('id'));
    const byPid = {};
    rows.forEach(r => { (byPid[r.patient_id] = byPid[r.patient_id] || []).push(fromRow('patient_records', r)); });
    ids.forEach(id => { const p = getPatient(id); if (p) { p.measurements = byPid[id] || []; p._recordsLoaded = true; } });
  },
  // ملاحظات مريض واحد عند الطلب — تُدمج في State.notes بدون تكرار
  async loadNotesFor(pid) {
    const rows = await this.fetchAll(() => this.sb.from('patient_notes').select('*')
      .eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
      .order('date', { ascending: false }).order('id', { ascending: false }));
    const fresh = rows.map(r => fromRow('patient_notes', r));
    State.notes = State.notes.filter(n => n.patientId !== pid).concat(fresh);
  },
  // قياسات البيت الحديثة (تغذية لوحة التحكم) — استهداف بالتاريخ والمصدر بدل مسح كل السجلات
  async recentPatientRecords(fromDate) {
    const rows = await this.fetchAll(() => this.sb.from('patient_records').select('*')
      .eq('doctor_id', this.uid).is('deleted_at', null).eq('source', 'patient')
      .gte('date', fromDate)
      .order('date', { ascending: false }).order('id', { ascending: false }));
    return rows
      .map(r => ({ m: fromRow('patient_records', r), p: getPatient(r.patient_id) }))
      .filter(x => x.p);
  },
  // سلسلة أوزان خفيفة (patient_id,date,weight) لمتوسط نزول الوزن في نبضة الشهر
  async weightSeries() {
    const rows = await this.fetchAll(() => this.sb.from('patient_records')
      .select('patient_id,date,weight')
      .eq('doctor_id', this.uid).is('deleted_at', null).not('weight', 'is', null)
      .order('date').order('id'));
    const byPid = {};
    rows.forEach(r => { (byPid[r.patient_id] = byPid[r.patient_id] || []).push({ date: r.date, weight: +r.weight }); });
    return byPid;
  },
  // كل مواعيد مريض من السيرفر (للحذف الكامل — النافذة المحمّلة قد لا تشمل الأقدم)
  async appointmentsOf(pid) {
    const rows = await this.fetchAll(() => this.sb.from('appointments').select('*')
      .eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null).order('id'));
    return rows.map(r => fromRow('appointments', r));
  },
  // نسخة كاملة لكل الصفوف — للاحتياطي المشفر فقط (بلا نافذة زمنية وبلا ترقيم)
  async dumpAll() {
    const g = (t) => this.fetchAll(() => this.sb.from(t).select('*')
      .eq('doctor_id', this.uid).is('deleted_at', null).order('id'));
    const [pats, apts, notes, plans, recs, clinics] = await Promise.all([
      g('patients'), g('appointments'), g('patient_notes'), g('plans'), g('patient_records'), g('clinics')
    ]);
    const patients = pats.map(r => fromRow('patients', r));
    const byPid = {};
    recs.forEach(r => { (byPid[r.patient_id] = byPid[r.patient_id] || []).push(fromRow('patient_records', r)); });
    patients.forEach(p => { p.measurements = byPid[p.id] || []; });
    return {
      patients,
      appointments: apts.map(r => fromRow('appointments', r)),
      notes: notes.map(r => fromRow('patient_notes', r)),
      plans: plans.map(r => fromRow('plans', r)),
      clinics: clinics.map(r => fromRow('clinics', r))
    };
  },
  // (بند 32) فحص اتصال حقيقي بنقطة صحة Supabase — الإعدادات ما تقولش «متصل» وهي مش متصلة
  async healthProbe() {
    if (!SUPABASE_READY) return { ok: false, label: 'غير مربوط — مفتاح Supabase ناقص' };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(supabaseConfig.url.replace(/\/$/, '') + '/auth/v1/health', { signal: ctl.signal });
      clearTimeout(t);
      return r.ok ? { ok: true, label: 'متصل — الخدمة تستجيب' } : { ok: false, label: 'تعذر الاتصال (HTTP ' + r.status + ')' };
    } catch (e) {
      return { ok: false, label: 'تعذر الاتصال — ' + (e && e.message ? e.message : 'خطأ شبكة') };
    }
  },

  async loadRecords(pid) {
    // Filter by patient AND doctor, excluding soft-deleted rows
    // (متوسط 1) paginated: سجل قياسات طويل (فوق 1000 صف) ما يتقصّش
    const data = await this.fetchAll(() => this.sb.from('patient_records').select('*')
      .eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
      .order('date').order('id'));
    const p = getPatient(pid);
    if (p) p.measurements = data.map(r => fromRow('patient_records', r));
  },
  async addRecord(pid, rec) {
    if (rec && rec.recordType === 'inbody') validateInBodyRecord(rec);
    const payload = {
      doctor_id: this.uid, patient_id: pid, date: rec.date,
      weight: rec.weight ?? null, waist: rec.waist ?? null, hips: rec.hips ?? null, arm: rec.arm ?? null, fat: rec.fat ?? null,
      session: rec.session ?? null, pain: rec.pain ?? null, note: rec.note || '',
      source: 'clinic' // قياس يسجله الطبيب؛ البوابة تفرض source='patient' في RPC
    };
    // Omit new nullable columns when unused so existing clinics can keep using
    // legacy measurement writes until the additive migration has been applied.
    if (rec.recordType === 'manual') {
      const weight = Number(rec.weight), height = Number(rec.height);
      payload.bmi = Number.isFinite(weight) && weight >= 20 && weight <= 350 &&
        Number.isFinite(height) && height >= 80 && height <= 230
        ? +(weight / Math.pow(height / 100, 2)).toFixed(1) : null;
      rec.bmi = payload.bmi;
    }
    for (const [key, column] of Object.entries({ height: 'height', bmi: 'bmi', bodyFatMass: 'body_fat_mass',
      skeletalMuscleMass: 'skeletal_muscle_mass', visceralFatLevel: 'visceral_fat_level',
      bodyWaterPct: 'body_water_pct', recordType: 'record_type' })) {
      if (key === 'bmi' && rec.recordType === 'manual') continue;
      if (rec[key] != null) payload[column] = rec[key];
    }
    const oid = offlineId(); if (oid) payload.id = oid;
    const { data, error } = await offlineCall(
      { kind: 'insert', table: 'patient_records', row: payload, label: 'قياس', clinicId: offlineClinicId() },
      () => this.sb.from('patient_records').insert(payload).select(),
      { data: [payload], error: null });
    if (error) throw error;
    rec.id = data[0].id;
    const p = getPatient(pid);
    (p.measurements = p.measurements || []).push(rec);
    await this.audit('create', 'patient_records', rec.id, { patientRef: true });
  },

  async updateRecord(pid, mid, patch) {
    const allowed = ['date', 'height', 'weight', 'waist', 'hips', 'arm', 'fat', 'bmi', 'bodyFatMass',
      'skeletalMuscleMass', 'visceralFatLevel', 'bodyWaterPct', 'recordType', 'session', 'pain', 'note'];
    const safe = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) safe[key] = patch[key];
    if (!Object.keys(safe).length) throw { code: 'empty_update' };
    if (safe.recordType === 'inbody') validateInBodyRecord(safe);
    const row = toRow('patient_records', safe);
    const fakeRow = Object.assign({ id: mid, patient_id: pid, doctor_id: this.uid, deleted_at: null }, row);
    const { data, error } = await offlineCall(
      { kind: 'update', table: 'patient_records', row, label: 'تعديل قياس', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: mid }, { col: 'patient_id', op: 'eq', val: pid },
          { col: 'doctor_id', op: 'eq', val: this.uid }, { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patient_records').update(row)
        .eq('id', mid).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null)
        .select().maybeSingle(),
      { data: fakeRow, error: null });
    if (error) throw error;
    if (!data) throw { code: 'clinical_record_not_found' };
    const p = getPatient(pid);
    if (p) p.measurements = (p.measurements || []).map(m => m.id === mid ? fromRow('patient_records', data) : m);
    await this.audit('edit', 'patient_records', mid, { patientRef: true });
    return fromRow('patient_records', data);
  },

  // Soft delete keeps the measurement in the archive (clinical history is immutable)
  // (بند 12) نفس المبدأ: الحذف من الذاكرة بعد نجاح السيرفر فقط
  async deleteRecord(pid, mid) {
    const delRow = { deleted_at: new Date().toISOString(), deleted_by: this.uid };
    const { error } = await offlineCall(
      { kind: 'update', table: 'patient_records', row: delRow, label: 'حذف قياس', clinicId: offlineClinicId(),
        where: [{ col: 'id', op: 'eq', val: mid }, { col: 'patient_id', op: 'eq', val: pid },
          { col: 'doctor_id', op: 'eq', val: this.uid }, { col: 'deleted_at', op: 'is', val: null }] },
      () => this.sb.from('patient_records').update(delRow)
        .eq('id', mid).eq('patient_id', pid).eq('doctor_id', this.uid).is('deleted_at', null),
      { data: null, error: null });
    if (error) throw error;
    const p = getPatient(pid);
    if (p) p.measurements = (p.measurements || []).filter(m => m.id !== mid);
    await this.audit('delete', 'patient_records', mid, { soft: true });
  }
};

