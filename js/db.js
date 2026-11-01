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
  patients: { targetWeight: 'target_weight', planId: 'plan_id', planStart: 'plan_start', planEnd: 'plan_end', createdAt: 'created_at', birthDate: 'birth_date', consentWa: 'consent_whatsapp' },
  appointments: { patientId: 'patient_id', patientName: 'patient_name', cancelledAt: 'cancelled_at', cancelReason: 'cancel_reason' },
  plans: { desc: 'description' },
  patient_notes: { patientId: 'patient_id', sugarType: 'sugar_type', bpSys: 'bp_sys', bpDia: 'bp_dia', nextVisit: 'next_visit' },
  // patient_records: أسماء محصورة — doctor_id و patient_id مفاتيح ثابتة تحت السيرفر
  patient_records: { patientId: 'patient_id', photoPath: 'photo_path' }
};

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
  const list = p.chronic || [];
  if (!list.length) return '';
  return list.filter(k => CHRONIC[k]).map(k =>
    '<span class="chip chip-' + CHRONIC[k].cls + '"><i class="fa-solid ' + CHRONIC[k].icon + '"></i>' +
    (small ? '' : ' ') + CHRONIC[k].label + '</span>').join('');
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

const DB = {
  uid: null, sb: null, ready: false, configError: null,

  // The app refuses to run without Supabase. There is no local demo mode:
  // patient data must never be written to localStorage.
  async init() {
    if (!SUPABASE_READY) {
      this.configError = 'setup-required';
      return false;
    }
    if (!window.supabase) {
      this.configError = 'تعذّر تحميل مكتبة Supabase من الشبكة — تحقق من الإنترنت أو من أدوات حظر الإعلانات ثم حدّث الصفحة';
      return false;
    }
    try {
      this.sb = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
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
      const totp = (data.totp || []).find(f => f.status === 'verified') || (data.totp || [])[0];
      if (!totp) throw { code: 'mfa_no_factor' };
      fid = totp.id;
    }
    const ch = await this.sb.auth.mfa.challenge({ factorId: fid });
    if (ch.error) throw ch.error;
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
      email, password: pass, options: { data: { doctor_name: name, specialty: spec } }
    });
    if (error) throw error;
    // When "Confirm email" is enabled there is no immediate session
    if (!data.session) throw { code: 'confirm-email' };
    this.uid = data.user.id;
    const s0 = defaultClinicData().settings;
    const { error: sErr } = await this.sb.from('doctors').upsert({
      id: this.uid,
      settings: {
        ...s0, doctorName: name, specialty: spec, clinicName: clinic || ('عيادة ' + name),
        // Every new clinic starts on a free trial — its expiry is enforced at login
        account: { status: 'trial', endsAt: addDaysISO(todayISO(), TRIAL_DAYS) }
      }
    });
    if (sErr) throw sErr;
    return 'mfa-enroll'; // 2FA enrollment is mandatory before reaching the app
  },

  async signOut() { await this.sb.auth.signOut(); this.uid = null; },

  async resetPassword(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  },

  /* ---- Append-only audit trail (never contains PHI) ---- */
  async audit(action, entity, entityId, meta) {
    if (!this.uid) return;
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
    const { data: docRow } = await this.sb.from('doctors').select('settings').eq('id', this.uid).maybeSingle();
    State.settings = (docRow && docRow.settings) ? docRow.settings : defaultClinicData().settings;
    return State.settings;
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
      const { data: docRow } = await this.sb.from('doctors').select('settings').eq('id', this.uid).maybeSingle();
      State.appointments = appointments;
      State.settings = (docRow && docRow.settings) ? docRow.settings : defaultClinicData().settings;
      State.pTotal = roster.filter(p => p.status === 'active').length;
      if (plans.length) { State.plans = plans; }
      else {
        // First sign-in: seed the starter nutrition-plan library for this doctor
        const seedRows = defaultClinicData().plans.map(pl => ({
          doctor_id: this.uid, title: pl.title, calories: pl.calories, description: pl.desc,
          duration: pl.duration, notes: pl.notes, meals: pl.meals,
          contraindications: pl.contraindications || null
        }));
        const { data: inserted, error } = await this.sb.from('plans').insert(seedRows).select();
        if (error) throw error;
        State.plans = (inserted || []).map(r => fromRow('plans', r));
      }
    }
    State.loaded = true;
    // Audit the bulk read without any PHI: counts only
    this.audit('view', 'patients', null, { scope: 'list', count: Object.keys(State.patientIndex).length });
  },

  // Load soft-deleted rows for the archive view (separate query, audited)
  async loadArchive(table) {
    // (متوسط 1) paginated + مفتاح ترتيب تاني (id) يستقر مع تساوي التوقيتات
    const data = await this.fetchAll(() => this.sb.from(table).select('*')
      .eq('doctor_id', this.uid).not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }).order('id'));
    await this.audit('view', table, null, { scope: 'archive', count: data.length });
    return data.map(r => fromRow(table, r));
  },

  // (بند 12) المريض + قياساته الأولى بيتسجلوا في معاملة واحدة ذرّية عبر RPC:
  // يا إما كله نجح يا إما مفيش حاجة اتسجلت — مفيش مريض يتيم ولا تكرار
  async add(col, data) {
    if (col === 'patients' && Array.isArray(data.measurements) && data.measurements.length) {
      const { data: r, error } = await this.sb.rpc('create_patient_with_measurements', {
        p_patient: {
          name: data.name, phone: data.phone, age: data.age ?? null, gender: data.gender || null,
          type: data.type, status: data.status || 'active', height: data.height ?? null,
          targetWeight: data.targetWeight ?? null, planId: data.planId || null,
          planStart: data.planStart || null, planEnd: data.planEnd || null,
          diagnosis: data.diagnosis || null, notes: data.notes || null, chronic: data.chronic || [],
          birthDate: data.birthDate || null, consentWa: data.consentWa || false
        },
        p_measurements: data.measurements.map(m => ({
          date: m.date || todayISO(), weight: m.weight ?? null,
          session: m.session ?? null, pain: m.pain ?? null, note: m.note || ''
        }))
      });
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
    delete row.id;           // id is generated by Postgres
    delete row.measurements; // القياسات تُحفظ في جدول patient_records المستقل
    row.doctor_id = this.uid; // عزل البيانات بالدكتور الحالي
    const { data: rows, error } = await this.sb.from(col).insert(row).select();
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
    const { error } = await this.sb.from(col).update(row).eq('id', id).eq('doctor_id', this.uid);
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
    const { error } = await this.sb.from(col)
      .update({ deleted_at: new Date().toISOString(), deleted_by: this.uid })
      .eq('id', id).eq('doctor_id', this.uid);
    if (error) throw error;
    State[col] = State[col].filter(x => x.id !== id);
    if (col === 'patients') delete State.patientIndex[id]; // (بند 31)
    await this.audit('delete', col, id, { soft: true });
  },

  // Bring a soft-deleted row back from the archive
  async restore(col, id) {
    const { error } = await this.sb.from(col)
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', id).eq('doctor_id', this.uid);
    if (error) throw error;
    await this.audit('restore', col, id);
    await this.loadAll();
  },

  // حفظ إعدادات العيادة — عبر RPC في السيرفر (save_clinic_settings):
  // 'account' (حالة الاشتراك) مستثناة هنا وفي السيرفر معاً، فنسخة قديمة
  // في الذاكرة مستحيل تكتب فوق تعليق/إنهاء عمله الأدمن. الدمج في السيرفر
  // shallow-merge على settings الحالية بدل استبدالها كاملة.
  async saveSettings(s) {
    const { account, ...clinic } = s; // account أدمن فقط (trigger guard_account)
    State.settings = { ...State.settings, ...clinic };
    const { error } = await this.sb.rpc('save_clinic_settings', { patch: clinic });
    if (error) throw error;
    await this.audit('edit', 'doctors', this.uid, { scope: 'settings' });
  },
  // ===== ملاحظات الزيارات ومتابعة الأمراض المزمنة (جدول patient_notes) =====
  async addNote(rec) {
    const row = toRow('patient_notes', rec);
    delete row.id; row.doctor_id = this.uid;
    const { data, error } = await this.sb.from('patient_notes').insert(row).select();
    if (error) throw error;
    rec.id = data[0].id;
    State.notes.push(rec);
    await this.audit('create', 'patient_notes', rec.id, { patientRef: true });
    return rec;
  },

  // Soft delete: the visit note stays in the archive for the legal retention period
  async deleteNote(id) {
    State.notes = State.notes.filter(n => n.id !== id);
    const { error } = await this.sb.from('patient_notes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: this.uid })
      .eq('id', id).eq('doctor_id', this.uid);
    if (error) throw error;
    await this.audit('delete', 'patient_notes', id, { soft: true });
  },

  // ===== سجل القياسات: جدول patient_records حقيقي في Postgres =====
  // (حذف المريض يحذف قياساته تلقائياً عبر on delete cascade)
  // ===== (بند 31) تحميل رشيق: فهرس خفيف + ترقيم من السيرفر + استعلامات مستهدفة =====
  // فهرس خفيف لكل المرضى (أعمدة أساسية فقط): يحسم الأسماء والمراجع والعدّادات
  // من غير تحميل الصفوف الكاملة — القائمة نفسها بتيجي صفحة-بصفحة من pagePatients
  async loadRoster() {
    const rows = await this.fetchAll(() => this.sb.from('patients')
      .select('id,name,phone,type,status,created_at,plan_id,diagnosis')
      .eq('doctor_id', this.uid).is('deleted_at', null).order('id'));
    const ps = rows.map(r => fromRow('patients', r));
    ps.forEach(p => { State.patientIndex[p.id] = p; });
    return ps;
  },
  // بانى استعلام قائمة المرضى (بحث + فلتر تخصص) — يُستخدم للصفوف وللعدّ معاً
  _pfQuery(q, type) {
    let b = this.sb.from('patients')
      .eq('doctor_id', this.uid).is('deleted_at', null).eq('status', 'active');
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
    const { data, error } = await this._pfQuery(opts.q, opts.type).select('*')
      .order('name').order('id')
      .range((page - 1) * per, page * per - 1);
    if (error) throw error;
    const { count, error: e2 } = await this._pfQuery(opts.q, opts.type)
      .select('*', { count: 'exact', head: true });
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
    const [pats, apts, notes, plans, recs] = await Promise.all([
      g('patients'), g('appointments'), g('patient_notes'), g('plans'), g('patient_records')
    ]);
    const patients = pats.map(r => fromRow('patients', r));
    const byPid = {};
    recs.forEach(r => { (byPid[r.patient_id] = byPid[r.patient_id] || []).push(fromRow('patient_records', r)); });
    patients.forEach(p => { p.measurements = byPid[p.id] || []; });
    return {
      patients,
      appointments: apts.map(r => fromRow('appointments', r)),
      notes: notes.map(r => fromRow('patient_notes', r)),
      plans: plans.map(r => fromRow('plans', r))
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
    const { data, error } = await this.sb.from('patient_records').insert({
      doctor_id: this.uid, patient_id: pid, date: rec.date,
      weight: rec.weight ?? null, waist: rec.waist ?? null, hips: rec.hips ?? null, arm: rec.arm ?? null, fat: rec.fat ?? null,
      session: rec.session ?? null, pain: rec.pain ?? null, note: rec.note || '',
      source: 'clinic' // المرحلة 16: علامة مصدر القياس (العيادة مقابل البيت)
    }).select();
    if (error) throw error;
    rec.id = data[0].id;
    const p = getPatient(pid);
    (p.measurements = p.measurements || []).push(rec);
    await this.audit('create', 'patient_records', rec.id, { patientRef: true });
  },

  // Soft delete keeps the measurement in the archive (clinical history is immutable)
  // (بند 12) نفس المبدأ: الحذف من الذاكرة بعد نجاح السيرفر فقط
  async deleteRecord(pid, mid) {
    const { error } = await this.sb.from('patient_records')
      .update({ deleted_at: new Date().toISOString(), deleted_by: this.uid })
      .eq('id', mid).eq('doctor_id', this.uid);
    if (error) throw error;
    const p = getPatient(pid);
    if (p) p.measurements = (p.measurements || []).filter(m => m.id !== mid);
    await this.audit('delete', 'patient_records', mid, { soft: true });
  }
};

