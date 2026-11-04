/**
 * ========================================
 * main.js
 * الوظيفة: الإقلاع (المرحلة 9): boot وربط كل أحداث الواجهة، تدفقات الدخول/التسجيل/استعادة الجلسة/2FA، موزع الأوامر المركزي Actions، التنقل، فلاتر المرضى، التقويم، ونموذجا الإعدادات ورسائل الواتساب.
 * الدوال/الكيانات الرئيسية: Actions، switchPTab، cacheDoctor، switchAuthTab، showMfaPane
 * الاعتمادات: كل الملفات السابقة
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/main.js — الإقلاع وربط الأحداث العامة (المرحلة 9)
   ============================================================ */
// التبديل بين تبويبات ملف المريض (قياسات / زيارات / خطة / مواعيد)
function switchPTab(t) {
  $$('#patTabs [data-ptab]').forEach(b => b.classList.toggle('active', b.dataset.ptab === t));
  ['measure', 'labs', 'health', 'visits', 'notes', 'plan', 'appts'].forEach(k => {
    const el = document.getElementById('ptab-' + k);
    if (el) el.classList.toggle('hide', k !== t);
  });
}

// موزّع الأوامر المركزي: كل زر له data-action يمر من هنا
const Actions = {
  'add-patient':   () => openPatientModal(),
  'edit-patient': async ds => {
    let p = getPatient(ds.id);
    if (p && !p._full) {
      try { p = await DB.loadPatientFull(ds.id); }
      catch (e) { logError(e, 'patient.edit'); toast('تعذّر تحميل بيانات المريض للتعديل — ' + explainError(e), 'error'); return; }
    }
    if (!p) { toast('تعذّر العثور على بيانات المريض للتعديل', 'error'); return; }
    if (normalizeClinicalFeatures((State.settings || {}).clinicalFeatures).measurements && !p._recordsLoaded) {
      try { await DB.loadRecords(p.id); p._recordsLoaded = true; }
      catch (e) { logError(e, 'patient.edit.records'); toast('تعذّر تحميل القياسات قبل التعديل — ' + explainError(e), 'error'); return; }
    }
    openPatientModal(p);
  },
  // الدفعة ٣: مفتاح طوارئ — يوقف/يشغّل الدخول من غير ما يغيّر الكود نفسه
  'pt-access-off': async ds => {
    try {
      const { data, error } = await DB.sb.rpc('set_patient_portal_access', { p_patient_id: ds.id, p_enabled: false });
      if (error) throw error;
      if (data && data.ok === false) throw { message: data.error || 'تعذّر الإيقاف' };
      toast('تم إيقاف دخول البوابة لهذا المريض');
      await renderPatientAccess(getPatient(ds.id) || { id: ds.id });
    } catch (e) { logError(e, 'patient.accessOff'); toast('تعذّر الإيقاف — ' + explainError(e), 'error'); }
  },
  'pt-access-on': async ds => {
    try {
      const { data, error } = await DB.sb.rpc('set_patient_portal_access', { p_patient_id: ds.id, p_enabled: true });
      if (error) throw error;
      if (data && data.ok === false) throw { message: data.error || 'تعذّر التشغيل' };
      toast('تم إعادة تشغيل دخول البوابة');
      await renderPatientAccess(getPatient(ds.id) || { id: ds.id });
    } catch (e) { logError(e, 'patient.accessOn'); toast('تعذّر التشغيل — ' + explainError(e), 'error'); }
  },
  // زراير الكود في ملف المريض: لا يوجد أي تدوير/تغيير للكود
  'pt-code-wa':    ds => sendPatientCodeWA(ds.id),
  'pt-code-copy':  () => copyPatientCode(),
  'del-patient':   ds => deletePatient(ds.id),
  'view-patient':  ds => go('patient', ds.id),
  'wa-patient':    ds => waPatient(ds.id),
  'add-appt':      () => openApptModal(),
  'appt-set':      ds => setApptStatus(ds.id, ds.status),
  'appt-wa':       ds => waAppt(ds.id),
  'add-plan':      () => openPlanModal(),
  'edit-plan':     ds => openPlanModal(getPlan(ds.id)),
  'del-plan':      ds => deletePlan(ds.id),
  'view-plan':     ds => openPlanView(ds.id),
  'assign-plan':   ds => openAssignModal(ds.id),       // من ملف المريض
  'assign-plan-top': ds => openAssignModal(ds.id),     // من بطاقة الخطة
  'unassign-plan': async ds => { await DB.update('patients', ds.id, { planId: null }); toast('تم فك ربط الخطة'); refreshCurrent(); },
  'wa-plan':       ds => waPlan(ds.id),
  'wa-congrats':   ds => waCongrats(ds.id),   // تهنئة بالنتيجة (خسارة X كجم)
  'wa-remind-plan': ds => waPlanReminder(ds.id), // تذكير بالخطة + موعد القياس القادم
  'add-note':      () => openNoteModal(State.param),  // ملاحظة زيارة + قراءات مزمنة
  'del-note':      ds => delNote(ds.id),
  'add-measure':   () => openMeasureModal(State.param),
  'del-measure':   ds => delMeasure(ds.id, ds.x),
  'add-inbody':    () => openInBodyModal(State.param),
  'edit-inbody':   ds => {
    const p = getPatient(ds.id);
    const rec = p && (p.measurements || []).find(m => m.id === ds.x && m.recordType === 'inbody');
    if (rec) openInBodyModal(ds.id, rec); else toast('فحص InBody غير موجود في سجل هذا المريض', 'error');
  },
  'del-inbody':    ds => delInBody(ds.id, ds.x),
  'add-lab':       () => openLabModal(State.param),
  'edit-lab':      ds => {
    const p = getPatient(ds.id);
    const lab = p && (p.labs || []).find(item => item.id === ds.x);
    if (lab) openLabModal(ds.id, lab); else toast('سجل التحليل غير موجود في ملف هذا المريض', 'error');
  },
  'del-lab':       ds => deletePatientLab(ds.id, ds.x),
  'add-health-reading': ds => openHealthReadingModal(ds.id, ds.x),
  'edit-health-reading': ds => editPatientHealthReading(ds.id, ds.x),
  'appt-for-patient': () => openApptModal(State.param), // حجز موعد من داخل ملف المريض
  'export':        () => exportBackup(),
  'decrypt-backup': () => decryptBackup(),
  // فتح صورة قياس — سيجند URL موقّت بساعة (عبر سياسة التخزين: المريض أو دكتوره بس)
  'view-photo': async ds => {
    const url = await storagePhotoUrl(ds.x);
    if (url) window.open(url, '_blank');
    else toast('تعذّر فتح الصورة — انتهت صلاحية الرابط المؤقت', 'error');
  },
  // نسخ كود SQL الخاص بإعداد Supabase للحافظة بضغطة واحدة
  'copy-sql': async () => {
    try { await navigator.clipboard.writeText(SUPABASE_SQL.trim()); toast('تم نسخ الكود — الصقه في SQL Editor واضغط Run'); }
    catch (e) { toast('انسخ الكود يدوياً من الصندوق', 'info'); }
  },
  // ---------- Phase 10: super admin + archive actions ----------
  'refresh-setup': () => location.reload(),
  'view-archive': () => openArchiveModal(),
  'restore-row':  async ds => {
    try { await DB.restore(ds.t, ds.id); toast('تمت الاستعادة من الأرشيف'); closeModal(); refreshCurrent(); }
    catch (e) { toast('تعذّرت الاستعادة — ' + explainError(e), 'error'); }
  },
  'adm-view':      ds => go('admin-doctor', ds.id),
  'adm-suspend':   ds => Admin.setStatus(ds.id, 'suspended', 'تعليق من لوحة الإدارة'),
  'adm-activate':  ds => Admin.setStatus(ds.id, 'active', 'تفعيل من لوحة الإدارة', addDaysISO(todayISO(), 30)),
  'adm-restore':   ds => Admin.setStatus(ds.id, 'active', 'استعادة من الأرشيف', addDaysISO(todayISO(), 30)),
  'adm-delete':    ds => Admin.deleteDoctor(ds.id),
  'adm-reset':     ds => Admin.resetPassword(ds.id),
  'adm-edit':      ds => Admin.editInfo(ds.id),
  'adm-month':     ds => Admin.setStatus(ds.id, 'active', 'اشتراك شهري — تفعيل إداري', addDaysISO(todayISO(), 30)),
  'adm-year':      ds => Admin.setStatus(ds.id, 'active', 'اشتراك سنوي — تفعيل إداري', addDaysISO(todayISO(), 365)),
  'adm-export':    () => Admin.exportJSON(),
  'logout':        () => doLogout()
};

// كاش بيانات الدكتور في sessionStorage (للجلسة الحالية فقط — تُمسح عند إغلاق المتصفح)
function cacheDoctor() {
  sessionStorage.setItem('clinic_doctor', JSON.stringify({
    uid: DB.uid, name: State.settings.doctorName, clinic: State.settings.clinicName
  }));
}

async function doLogout() {
  sessionStorage.removeItem('clinic_doctor'); // مسح الكاش عند الخروج
  if (typeof OfflineSnapshot !== 'undefined') {
    try { await OfflineSnapshot.clearAll(); } catch (_) { /* no-op */ }
  }
  if (typeof Offline !== 'undefined') Offline.snapshotNote = null;
  await DB.signOut();
  showScreen('login');
  toast('تم تسجيل الخروج — إلى اللقاء يا دكتور', 'info');
}

// (switchAuthTab lives beside boot() — it knows the admin and MFA panes too)

let mfaPending = { factorId: null, access: 'doctor' };

// Show/hide auth sub-screens consistently (login / register / reset / admin / mfa)
function switchAuthTab(t) {
  const tabsEl = document.querySelector('.auth-tabs');
  tabsEl.style.display = (t === 'reset' || t === 'admin' || t === 'mfa' || t === 'patient') ? 'none' : 'flex';
  $('#tabLogin').classList.toggle('active', t === 'login');
  $('#tabRegister').classList.toggle('active', t === 'register');
  $('#loginForm').classList.toggle('hide', t !== 'login');
  $('#registerForm').classList.toggle('hide', t !== 'register');
  $('#resetForm').classList.toggle('hide', t !== 'reset');
  $('#adminLoginForm').classList.toggle('hide', t !== 'admin');
  $('#mfaPane').classList.toggle('hide', t !== 'mfa');
  $('#ptLoginForm').classList.toggle('hide', t !== 'patient');
}

// Show the 2FA pane in the correct sub-mode (re-enroll with QR, or just the code box)
function showMfaPane(isEnroll, qr, secret) {
  switchAuthTab('mfa');
  $('#mfaEnrollBox').classList.toggle('hide', !isEnroll);
  $('#mfaHint').textContent = isEnroll
    ? 'امسح الرمز بالأسفل بتطبيق المصادقة ثم اكتب الكود المتغير للدخول'
    : 'اكتب الرمز الظاهر في تطبيق المصادقة لإكمال تسجيل الدخول';
  if (isEnroll && qr) {
    const img = $('#mfaQr');
    img.src = String(qr).startsWith('data:') ? qr : 'data:image/svg+xml;utf8,' + encodeURIComponent(qr);
    $('#mfaSecret').textContent = secret || '';
  }
  $('#mfaCode').value = '';
  $('#mfaError').classList.remove('show');
  setTimeout(() => $('#mfaCode').focus(), 150);
}

/* ═══════════════════ Central post-auth router ═══════════════════
   Every auth path ends here. Decides doctor app / admin console / 2FA. */
/** نسخة أوفلاين **للقراءة فقط** لشاشة الدكتور على جهاز العيادة.
 *  مش بديل عن الدخول ولا MFA: `readDoctor` بيتأكد إن `uid` الجلسة الحالية
 *  يطابق `uid` النسخة، وإن كاش `clinic_doctor` لسه موجود في نفس المتصفح.
 *  بنرجّع true لو قدرنا نفتح النسخة، فالـ catch الأصلي ما يرميش خطأ. */
async function tryOfflineDoctorFallback(err) {
  if (typeof Offline === 'undefined' || typeof OfflineSnapshot === 'undefined') return false;
  if (!Offline.isNetworkError(err) || !DB.uid) return false;
  let snap;
  try { snap = await OfflineSnapshot.readDoctor(DB.uid); } catch (_) { return false; }
  if (!snap || !snap.data) return false;
  const d = snap.data;
  resetClinicalState();
  State.settings = d.settings || {};
  State.clinics = d.clinics || [];
  State.activeClinicId = d.activeClinicId || null;
  State.patientIndex = d.patientIndex || {};
  State.pTotal = d.pTotal || 0;
  State.appointments = d.appointments || [];
  State.plans = d.plans || [];
  State.healthAlerts = d.healthAlerts || [];
  State.stats = d.stats || { visits: [], revenue: [] };
  State.loaded = true;
  State.offlineSnapshot = snap.savedAt;
  Offline.snapshotNote = '📴 نسخة أوفلاين للقراءة لبيانات العيادة من ' +
    OfflineSnapshot.fmt(snap.savedAt) +
    (snap.stale ? ' — قديمة، راجع لما النت يرجع' : '') +
    (d.rosterTruncated ? ' (فهرس مختصر)' : '') +
    '؛ أي تسجيل جديد هيتحفظ ويُرفع أول ما النت يرجع';
  if (typeof Offline.setRole === 'function') Offline.setRole('clinic');
  try {
    buildNav();
    syncShellIdentity();
    showScreen('app');
    go('dashboard');
  } catch (e) { logError(e, 'offline.doctor.render'); }
  toast('النت مقطوع — بتشوف نسخة مشفّرة للقراءة من جهازك', 'info');
  return true;
}

async function routeAfterAuth(step, access) {
  // الدفعة ٢: الجهاز ده جهاز عيادة → التنبيهات للدكتور، ونرفع المعلّق فور الدخول
  // رجعنا أونلاين فعلاً → النسخة للقراءة ما تفضلش معلّمة على الشاشة
  if (State.offlineSnapshot) {
    State.offlineSnapshot = null;
    if (typeof Offline !== 'undefined') Offline.snapshotNote = null;
  }
  if (typeof OfflineCapture !== 'undefined') {
    OfflineCapture.enter('clinic');
    OfflineCapture.syncWhenReady();
  }
  if (step === 'mfa-verify') { mfaPending = { factorId: null, access }; showMfaPane(false); return; }
  if (step === 'mfa-enroll') {
    const en = await DB.mfaEnroll();
    mfaPending = { factorId: en.factorId, access };
    showMfaPane(true, en.qr, en.secret);
    return;
  }
  // step === 'ready': begin from a clean identity-scoped cache before loading
  // any account data; this prevents a prior doctor's roster surviving logout.
  resetClinicalState();
  let role = access;
  if (role === 'auto') role = (await DB.isSuperAdmin()) ? 'admin' : 'doctor';
  if (role === 'admin') {
    if (!(await DB.isSuperAdmin())) { await DB.signOut(); throw { code: 'not_admin' }; }
    await enterAdmin();
    return;
  }
  // doctor
  buildNav(); // initialize both navigation rails on fresh login and session restore
  State.loaded = false; showScreen('app'); go('dashboard'); // skeletons first
  // بوابة الاشتراك قبل أي تحميل: الحساب الموقوف/المنتهي لازم ما يسحبش أي
  // بيانات مرضى للذاكرة أصلاً — والفحص بقى مدعوماً من السيرفر كمان لأن
  // clinic_active() جزء من سياسات RLS على كل الجداول الطبية.
  try {
    await DB.loadSettingsRow();
    try {
      DB.assertActive(); // subscription / suspension / expiry gate
    } catch (e) {
      await DB.signOut(); // a blocked account must never stay inside the app
      throw e;
    }
    // الدفعة ٣: الفروع + الفرع الحالي قبل أي إدراج (ترايجر الوسم بيقرأ doctors.settings).
    // الـ guard يسمح باختبارات الـ mock اللي ما تعرفش loadClinics.
    if (typeof DB.loadClinics === 'function') await DB.loadClinics();
    await DB.loadAll();
  } catch (e) {
    if (await tryOfflineDoctorFallback(e)) return;
    // The login/MFA form owns the error message; do not leave it hidden behind
    // a dashboard that will otherwise stay in the loading state forever.
    showScreen('login');
    throw e;
  }
  cacheDoctor();
  syncShellIdentity();
  go('dashboard');
  toast('أهلاً بك ' + (State.settings.doctorName || 'دكتور'));
}

// The rest is inside the boot to keep all bindings together
async function boot() {
  // Central action dispatcher + navigation + modal close (also needed on the setup screen)
  document.addEventListener('click', e => {
    const ac = e.target.closest('[data-action]');
    if (ac) { const fn = Actions[ac.dataset.action]; if (fn) fn(ac.dataset); return; }
    const tb = e.target.closest('[data-ptab]');
    if (tb) { switchPTab(tb.dataset.ptab); return; }
    const rg = e.target.closest('[data-range]');
    if (rg) {
      State.pRange = rg.dataset.range;
      $$('#rangeTabs button').forEach(x => x.classList.toggle('active', x === rg));
      const pp = getPatient(State.param);
      if (pp) drawPatientChart(pp);
      return;
    }
    const nv = e.target.closest('[data-nav]');
    if (nv) { go(nv.dataset.nav); return; }
    const rt = e.target.closest('[data-route]');
    if (rt) { go(rt.dataset.route); return; }
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    if (e.target.classList && e.target.classList.contains('modal-overlay')) closeModal();
  });

  // Close modals with Escape
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // 1) HARD GATE: لازم عميل Supabase مضبوط. الأوفلاين يعني «نسخة واجهة + دفتر مشفّر
  //    على جهاز المستخدم»، مش وضع ديمو ولا بيانات مرضى دائمة في المتصفح (راجع js/offline.js).
  const ok = await DB.init();
  if (!ok) {
    if (DB.configError === 'setup-required' || DB.configError) {
      $('#setupSql').textContent = SUPABASE_SQL.trim();
      if (DB.configError && DB.configError !== 'setup-required') {
        $('#setupErr').textContent = 'خطأ في الإعدادات أو الشبكة: ' + DB.configError;
        $('#setupErr').classList.add('show');
      }
      showScreen('setup');
    }
    return; // blocking screen — لا يوجد وضع تجريبي للبيانات الحقيقية
  }

  // 2) Chart.js global fonts/RTL
  if (window.Chart) {
    Chart.defaults.font.family = "'Cairo', sans-serif";
    Chart.defaults.font.weight = 600;
    Chart.defaults.color = '#64748b';
  }

  // 3) Auth tabs + routing
  $('#tabLogin').onclick = () => switchAuthTab('login');
  $('#tabRegister').onclick = () => switchAuthTab('register');
  $('#forgotBtn').onclick = () => switchAuthTab('reset');
  $('#resetBack').onclick = () => switchAuthTab('login');
  // reset.html يرسل الزائر هنا لطلب رابط جديد — نفتح تبويب الاستعادة مباشرة
  // (typeof يحمي اختبارات الـ DOM المحاكى اللي ما بتعرّفش location)
  if (typeof location !== 'undefined' && location.hash === '#reset') switchAuthTab('reset');
  $('#adminLink').onclick = () => switchAuthTab('admin');
  $('#adBack').onclick = () => switchAuthTab('login');

  // 4) Doctor login → 2FA gate → app
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#loginBtn'), err = $('#loginError');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الدخول...</span>';
    err.classList.remove('show');
    try {
      const step = await DB.signIn($('#loginEmail').value.trim(), $('#loginPass').value);
      await routeAfterAuth(step, 'doctor');
    } catch (ex) {
      err.innerHTML = esc(explainError(ex));
      // retry affordance for network-shaped errors only
      if (/Failed to fetch|network|NetworkError/i.test(ex.message || '')) {
        err.innerHTML += ' <button class="btn btn-ghost sm" id="retryLogin">إعادة المحاولة</button>';
        $('#retryLogin').onclick = () => $('#loginForm').requestSubmit();
      }
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>دخول</span>';
  };

  // 5) Create account → mandatory 2FA enrollment
  $('#registerForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('#regError'), btn = $('#regBtn');
    err.classList.remove('show');
    const name = $('#regName').value.trim(), spec = $('#regSpec').value, clinic = $('#regClinic').value.trim();
    const email = $('#regEmail').value.trim(), p1 = $('#regPass').value, p2 = $('#regPass2').value;
    if (!name) { err.textContent = 'اكتب اسم الدكتور أولاً'; err.classList.add('show'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'صيغة البريد الإلكتروني غير صحيحة'; err.classList.add('show'); return; }
    if (p1.length < 8) { err.textContent = 'كلمة المرور قصيرة — 8 أحرف على الأقل'; err.classList.add('show'); return; }
    if (p1 !== p2) { err.textContent = 'كلمتا المرور غير متطابقتين — أعد كتابتهما'; err.classList.add('show'); return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ إنشاء الحساب...</span>';
    try {
      const step = await DB.register(name, spec, clinic, email, p1);
      await routeAfterAuth(step, 'doctor');
    } catch (ex) {
      err.textContent = explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i><span>إنشاء الحساب</span>';
  };

  // 6) Password reset — safe, unchanged
  $('#resetForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('#resetError'), ok = $('#resetOk'), btn = $('#resetBtn');
    err.classList.remove('show'); ok.style.display = 'none';
    const email = $('#resetEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'اكتب بريداً إلكترونياً صحيحاً'; err.classList.add('show'); return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الإرسال...</span>';
    try {
      await DB.resetPassword(email);
      ok.querySelector('span').textContent = 'تم الإرسال إلى ' + email + ' — افتح بريدك واتبع رابط إعادة التعيين (راجع الرسائل غير المهمة أيضاً)';
      ok.style.display = 'flex';
    } catch (ex) {
      err.textContent = explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>إرسال رابط الاستعادة</span>';
  };

  // 7b) Patient portal login — permanent clinic-issued access code + phone.
  $('#patientLink').onclick = () => switchAuthTab('patient');
  $('#ptBack').onclick = () => switchAuthTab('login');
  $('#ptLoginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#ptBtn'), err = $('#ptError');
    err.classList.remove('show');
    const phone = $('#ptPhone').value.trim();
    try { portalAuthPhone(phone); }
    catch (ex) { err.textContent = ex.message; err.classList.add('show'); return; }
    const code = String($('#ptCode').value || '').trim().toUpperCase();
    // يقبل الكود القصير الجديد PREFIX-###### والكود القديم الطويل اللي استلمه المريض
    if (!/^[A-Z0-9]{2,12}(?:-\d{6}|(?:-[A-Z0-9]{4}){3})$/.test(code)) {
      err.textContent = 'اكتب الكود زي ما هو مكتوب في كارت العيادة (مثال: SHB1-482913).';
      err.classList.add('show'); return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ التحقق...</span>';
    try {
      await Portal.login(phone, code);
      toast('أهلاً بيك ' + (Portal.data && Portal.data.patient && Portal.data.patient.name.split(' ')[0] || ''));
    } catch (ex) {
      err.textContent = ex.message || explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.querySelector('span').textContent = 'دخول بوابة المرضى';
  };

  // 7c) Patient portal logout + tab navigation inside the portal
  $('#ptLogout').onclick = () => Portal.logout();
  // ناڤ البوابة: الرئيسية / تطورك
  $$('#patientPortal [data-pview]').forEach(b => {
    b.onclick = () => portalGo(b.dataset.pview);
  });
  // أزرار الفترة الزمنية لمنحنى المريض
  $$('#ptRangeTabs button').forEach(b => {
    b.onclick = () => {
      $$('#ptRangeTabs button').forEach(x => x.classList.toggle('active', x === b));
      portalRange = b.dataset.prange;
      portalRenderProgress();
    };
  });
  // زر «شوف الكل» في سجل القياسات
  $('#ptAllRows').onclick = () => {
    portalTableExpanded = !portalTableExpanded;
    if (Portal.token) portalRenderProgress();
  };

  // 8) Super-admin login (separate, still guarded by 2FA + membership check)
  $('#adminLoginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#adBtn'), err = $('#adError');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الدخول...</span>';
    err.classList.remove('show');
    try {
      const step = await DB.signIn($('#adEmail').value.trim(), $('#adPass').value);
      await routeAfterAuth(step, 'admin');
    } catch (ex) {
      err.textContent = explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-shield"></i><span>دخول الإدارة</span>';
  };

  // 8) 2FA verification — complete enrollment or raise aal2 as needed, then route
  $('#mfaGo').onclick = async () => {
    const btn = $('#mfaGo'), err = $('#mfaError');
    const code = $('#mfaCode').value.replace(/\D/g, '').slice(0, 6);
    err.classList.remove('show');
    if (code.length !== 6) { err.textContent = 'اكتب الرمز الظاهر في تطبيق المصادقة — 6 أرقام'; err.classList.add('show'); return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ التحقق...</span>';
    try {
      await DB.mfaVerify(code, mfaPending.factorId);
      await routeAfterAuth('ready', mfaPending.access);
    } catch (ex) {
      err.textContent = explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i><span>تأكيد ودخول</span>';
  };
  $('#mfaBack').onclick = async () => { await DB.signOut(); switchAuthTab('login'); };
  // Enter in the 2FA code box submits like the button (mobile + desktop convenience)
  $('#mfaCode').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('#mfaGo').click(); });

  // 10) Leave handlers
  $('#btnLogout').onclick = doLogout;
  $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#sidebarOverlay').classList.add('show'); };
  $('#sidebarOverlay').onclick = () => { $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('show'); };

  // 11) Patient filters/search
  $('#filterTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    $$('#filterTabs button').forEach(x => x.classList.toggle('active', x === b));
    State.pFilter = b.dataset.filter; State.pPage = 1; renderPatients(); // (بند 31) فلتر جديد = صفحة أولى
  });
  // (بند 31) البحث بقى استعلام سيرفر — debounce خفيف يمنع زحمة طلبات أثناء الكتابة
  let _pSearchTimer = null;
  $('#patientSearch').addEventListener('input', e => {
    State.pSearch = e.target.value; State.pPage = 1;
    clearTimeout(_pSearchTimer);
    _pSearchTimer = setTimeout(() => renderPatients(), 250);
  });

  // 12) Calendar navigation
  $('#calPrev').onclick = () => { Cal.anchor = addDaysISO(Cal.anchor, -7); renderAppointments(); };
  $('#calNext').onclick = () => { Cal.anchor = addDaysISO(Cal.anchor, +7); renderAppointments(); };
  $('#calToday').onclick = () => { Cal.anchor = Cal.selected = todayISO(); renderAppointments(); };

  // 13) Doctor settings save
  $('#settingsForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#settingsForm').querySelector('button[type="submit"]');
    const oldLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> جارٍ الحفظ...';
    try {
      await DB.saveSettings({
        clinicName: $('#setClinic').value.trim(), doctorName: $('#setDoctor').value.trim(),
        phone: $('#setPhone').value.trim(), price: +$('#setPrice').value || 0, address: $('#setAddress').value.trim(),
        clinicalFeatures: {
          measurements: $('#setFeatureMeasurements').checked === true,
          inbody: $('#setFeatureInbody').checked === true,
          labs: $('#setFeatureLabs').checked === true,
          glucoseTracking: $('#setFeatureGlucose').checked === true,
          bloodPressureTracking: $('#setFeatureBloodPressure').checked === true
        }
      });
      syncShellIdentity();
      toast('تم حفظ إعدادات العيادة');
    } catch (ex) {
      toast('تعذّر حفظ الإعدادات — ' + explainError(ex), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldLabel;
    }
  };

  // 14) الدفعة ٣: مُبدّل «الفرع الحالي» — الاختيار محفوظ في doctors.settings
  // عبر RPC الموجودة save_clinic_settings، والترايجر يوسم الصفوف الجديدة تلقائياً.
  const activeClinicSel = $('#activeClinic');
  if (activeClinicSel) activeClinicSel.onchange = async e => {
    const id = e.target.value || null, old = State.activeClinicId;
    State.activeClinicId = id;
    try {
      const { error } = await DB.sb.rpc('save_clinic_settings', { patch: { activeClinicId: id } });
      if (error) throw error;
      if (State.settings) State.settings.activeClinicId = id;
      State.pPage = 1;
      await DB.loadAll();
      syncShellIdentity();
      refreshCurrent();
      toast('تم تبديل الفرع الحالي');
    } catch (ex) {
      State.activeClinicId = old;
      e.target.value = old || '';
      toast('تعذّر تبديل الفرع — ' + explainError(ex), 'error');
    }
  };

  // 15) الدفعة ٣: الدكتور يختار بادئة الفرع (مرة واحدة، وتُقفل بعد أول كود)
  const prefixSave = $('#clinicPrefixSave');
  if (prefixSave) prefixSave.onclick = async () => {
    const cid = $('#clinicPrefixFor').value;
    const code = ($('#clinicPrefixValue').value || '').trim().toUpperCase();
    if (!cid) { toast('اختر الفرع الأول', 'error'); return; }
    if (!/^[A-Z0-9]{2,12}$/.test(code)) { toast('البادئة لازم من ٢ لـ ١٢ حرف إنجليزي كبير أو رقم، بدون شرطات', 'error'); return; }
    try {
      const { error } = await DB.sb.rpc('set_clinic_prefix', { p_clinic_id: cid, p_code: code });
      if (error) throw error;
      if (typeof DB.loadClinics === 'function') await DB.loadClinics();
      syncShellIdentity();
      renderClinicBranches();
      toast('تم حفظ البادئة ' + code);
    } catch (ex) { toast('تعذّر حفظ البادئة — ' + explainError(ex), 'error'); }
  };

  // 16) الدفعة ٣: إضافة فرع جديد (نفس حساب الدكتور، لوج واحد)
  const clinicAdd = $('#clinicAddSave');
  if (clinicAdd) clinicAdd.onclick = async () => {
    const name = ($('#newClinicName').value || '').trim();
    if (!name) { toast('اكتب اسم الفرع', 'error'); return; }
    try {
      const { error } = await DB.sb.from('clinics').insert({ doctor_id: DB.uid, name: name, is_default: false });
      if (error) throw error;
      $('#newClinicName').value = '';
      if (typeof DB.loadClinics === 'function') await DB.loadClinics();
      syncShellIdentity();
      renderClinicBranches();
      toast('تم إضافة الفرع: ' + name);
    } catch (ex) { toast('تعذّر إضافة الفرع — ' + explainError(ex), 'error'); }
  };

  // Restore the patient portal only after all UI handlers are bound. A rejected
  // token is cleared by Portal.load and must not prevent doctor session restore.
  const ptSaved = sessionStorage.getItem('clinic_patient_token');
  if (ptSaved) {
    Portal.token = ptSaved;
    try { await Portal.load(true); }
    catch (e) { Portal.token = null; sessionStorage.removeItem('clinic_patient_token'); }
  }

  // Keep the patient portal in front of an existing doctor session, but always
  // register the listener so it remains available after the patient logs out.
  // أول ما النت يرجع: استنّى عامل الرفع يخلص، ثم حدّث الشاشة من السيرفر
  // وامسح علامة «نسخة أوفلاين» (Offline.init سجّل مستمع الرفع قبل boot).
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', async () => {
      if (!State.offlineSnapshot || typeof Offline === 'undefined') return;
      for (let i = 0; i < 20 && Offline._flushing; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      State.offlineSnapshot = null;
      Offline.snapshotNote = null;
      try {
        await DB.loadAll();
        cacheDoctor(); syncShellIdentity(); refreshCurrent();
        toast('النت رجع — اتحدّثت بيانات العيادة من السيرفر', 'info');
      } catch (e) { logError(e, 'offline.doctor.refresh'); }
    });
  }

  DB.sb.auth.onAuthStateChange(async (_evt, session) => {
    if (Portal.token) return;
    if (_evt === 'INITIAL_SESSION' && session && session.user && !DB.uid) {
      DB.uid = session.user.id;
      try {
        const step = await DB.mfaGate(); // may be ready / mfa-verify / mfa-enroll
        await routeAfterAuth(step, 'auto'); // role detection is the router's job
      } catch (ex) {
        logError(ex, 'session.restore');
        // الدفعة ٤+: جلسة مخزّنة + فشل شبكي في MFA/التحميل → النسخة المشفّرة
        if (await tryOfflineDoctorFallback(ex)) return;
        switchAuthTab('login');
        $('#loginError').textContent = explainError(ex);
        $('#loginError').classList.add('show');
        showScreen('login');
      }
    }
    if (_evt === 'SIGNED_OUT') {
      DB.uid = null;
      resetClinicalState();
      // انتهاء/إلغاء الجلسة من السيرفر → النسخ المشفّرة ما تفضلش متاحة
      if (typeof OfflineSnapshot !== 'undefined') OfflineSnapshot.clearAll().catch(() => {});
      sessionStorage.removeItem('clinic_doctor');
      leaveAdmin();
      showScreen('login');
    }
  });
}

document.addEventListener('DOMContentLoaded', boot);