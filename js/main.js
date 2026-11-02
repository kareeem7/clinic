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
async function routeAfterAuth(step, access) {
  if (step === 'mfa-verify') { mfaPending = { factorId: null, access }; showMfaPane(false); return; }
  if (step === 'mfa-enroll') {
    const en = await DB.mfaEnroll();
    mfaPending = { factorId: en.factorId, access };
    showMfaPane(true, en.qr, en.secret);
    return;
  }
  // step === 'ready': resolve the role and its own dashboard
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
    await DB.loadAll();
  } catch (e) {
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

  // 1) HARD GATE: no Supabase = no app. Patient data must never touch localStorage.
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

  // 7b) Patient portal login — phone + birthdate, no email needed
  $('#patientLink').onclick = () => switchAuthTab('patient');
  $('#ptBack').onclick = () => switchAuthTab('login');
  $('#ptLoginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#ptBtn'), err = $('#ptError');
    err.classList.remove('show');
    const phone = $('#ptPhone').value.trim(), birth = $('#ptBirth').value;
    // client validation: phone looks Egyptian + birthdate is set
    const digits = phone.replace(/\D/g, '');
    if ((digits.length < 10 || digits.length > 13)) { err.textContent = 'اكتب رقم موبايل صحيح (01xxxxxxxxx)'; err.classList.add('show'); return; }
    if (!birth) { err.textContent = 'اكتب تاريخ ميلادك'; err.classList.add('show'); return; }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>جارٍ الدخول...</span>';
    try {
      await Portal.login(phone, birth);
      toast('أهلاً بيك ' + (Portal.data && Portal.data.patient && Portal.data.patient.name.split(' ')[0] || ''));
    } catch (ex) {
      err.textContent = ex.message || explainError(ex);
      err.classList.add('show');
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i><span>دخول البوابة</span>';
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
  DB.sb.auth.onAuthStateChange(async (_evt, session) => {
    if (Portal.token) return;
    if (_evt === 'INITIAL_SESSION' && session && session.user && !DB.uid) {
      DB.uid = session.user.id;
      try {
        const step = await DB.mfaGate(); // may be ready / mfa-verify / mfa-enroll
        await routeAfterAuth(step, 'auto'); // role detection is the router's job
      } catch (ex) {
        logError(ex, 'session.restore');
        switchAuthTab('login');
        $('#loginError').textContent = explainError(ex);
        $('#loginError').classList.add('show');
        showScreen('login');
      }
    }
    if (_evt === 'SIGNED_OUT') { leaveAdmin(); showScreen('login'); }
  });
}

document.addEventListener('DOMContentLoaded', boot);