/**
 * ========================================
 * app.js
 * الوظيفة: غلاف التطبيق والتنقل: خريطة المسارات ROUTES والسجلات RENDERERS، دوال go/showScreen/refreshCurrent، مزامنة هوية الشريط الجانبي، وإنشاء الرسوم البيانية makeChart.
 * الدوال/الكيانات الرئيسية: ROUTES، RENDERERS، go، refreshCurrent، showScreen، syncShellIdentity
 * الاعتمادات: state.js, utils.js, db.js + كل ملفات العرض (dashboard/patients/.../admin/settings) —
 *            لأن ROUTES/RENDERERS بتشير لدوالها وقت التقييم، فالملف ده بيُحمَّل قبل main.js مباشرة
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* الهوية المحايدة مصدرها الوحيد js/config.js ← APP_BRAND (يُحمّل قبل ده).
   بعد الدخول تُستبدل فعلياً من State.settings / جدول clinics.
   typeof يحمي سياقات الاختبارات اللي بتحمّل الملف ده لوحده. */
const SHELL_BRAND = (typeof APP_BRAND !== 'undefined' && APP_BRAND) || {};

/* ============================================================
   js/app.js — التنقل بين الأقسام وإدارة الشاشة
   ============================================================ */
const ROUTES = {
  dashboard: 'الرئيسية', patients: 'المرضى', patient: 'ملف المريض', appointments: 'المواعيد', plans: 'خطط التغذية', settings: 'الإعدادات',
  'admin-dashboard': 'لوحة الإدارة', 'admin-doctors': 'الدكاترة والعيادات', 'admin-doctor': 'ملف الدكتور', 'admin-settings': 'إعدادات النظام'
};
const RENDERERS = {
  dashboard: renderDashboard, patients: renderPatients,
  patient: () => renderPatientDetail(State.param),
  appointments: renderAppointments, plans: renderPlans, settings: renderSettings,
  'admin-dashboard': () => Admin.renderDashboard(),
  'admin-doctors': () => Admin.renderDoctors(),
  'admin-doctor': () => Admin.renderDoctor(State.param),
  'admin-settings': () => Admin.renderSettings()
};
function go(route, param) {
  // Tenant-guarded navigation: admin routes need admin mode and vice versa.
  const ADMIN_ROUTES = ['admin-dashboard', 'admin-doctors', 'admin-doctor', 'admin-settings'];
  if (ADMIN_ROUTES.includes(route) && !State.isAdmin) {
    toast('هذه الصفحة خاصة بإدارة النظام فقط', 'error');
    route = 'dashboard';
  }
  if (State.isAdmin && !ADMIN_ROUTES.includes(route) && ROUTES[route]) route = 'admin-dashboard';
  // نسخة الأوفلاين للقراءة: شاشتا المرضى/ملف المريض بيجيبوا صفحات من السيرفر،
  // فما نسيبهمش يطلعوا خطأ شبكة — بنوجّه للرئيسية اللي بتتغذى من النسخة.
  if (State.offlineSnapshot && typeof Offline !== 'undefined' && !Offline.isOnline &&
      (route === 'patients' || route === 'patient')) {
    toast('الشاشة دي محتاجة نت — النسخة الأوفلاين للقراءة من الرئيسية', 'info');
    route = 'dashboard';
  }
  State.route = route; if (param !== undefined) State.param = param;
  $$('.view').forEach(v => v.classList.remove('active'));
  const v = $('#view-' + route); if (v) v.classList.add('active');
  // تفعيل أزرار التنقل (ملف المريض يُبرز تبويب المرضى)
  $$('[data-route]').forEach(b => b.classList.toggle('active',
    b.dataset.route === route || (route === 'patient' && b.dataset.route === 'patients') ||
    (route === 'admin-doctor' && b.dataset.route === 'admin-doctors')));
  $('#topTitle').textContent = ROUTES[route] || '';
  $('#topDate').textContent = longDate(new Date());
  $('#topActions').style.display = State.isAdmin ? 'none' : ''; // إخفاء زر «مريض جديد» في وضع الإدارة
  $('#sidebar').classList.remove('open');
  $('#sidebarOverlay').classList.remove('show');
  window.scrollTo({ top: 0 });
  RENDERERS[route] && RENDERERS[route]();
}
function refreshCurrent() { RENDERERS[State.route] && RENDERERS[State.route](); }

// إظهار شاشة الدخول أو التطبيق
function showScreen(name) {
  $('#loginView').hidden = name !== 'login';
  $('#setupView').hidden = name !== 'setup';
  $('#appShell').hidden = name !== 'app';
  $('#patientPortal').hidden = name !== 'portal';
  // Warm theme applies only while the patient portal is visible
  document.body.classList.toggle('theme-patient', name === 'portal');
}

// مزامنة أسماء العيادة في الواجهة من الإعدادات
function syncShellIdentity() {
  // إزالة هيكل التحميل بعد ما القيم الحقيقية بقت جاهزة
  $('#sideClinicName').classList.remove('skel');
  $('#sideDoctor').classList.remove('skel');
  if (State.isAdmin) {
    document.querySelector('.side-brand strong').textContent = SHELL_BRAND.adminPanel || 'إدارة النظام';
    $('#sideClinicName').textContent = SHELL_BRAND.systemName || 'منظومة عيادتي';
    $('#sideDoctor').textContent = SHELL_BRAND.admin || 'مدير النظام';
    $('#sideAvatar').textContent = 'أ';
    return;
  }
  const s = State.settings;
  document.querySelector('.side-brand strong').textContent = SHELL_BRAND.product || 'عيادتي';
  $('#sideClinicName').textContent = s.clinicName || SHELL_BRAND.clinic || 'عيادتي';
  $('#sideDoctor').textContent = s.doctorName || SHELL_BRAND.doctor || 'الدكتور';
  $('#sideAvatar').textContent = (s.doctorName || 'د').replace('د.', '').trim()[0] || 'د';
  // الدفعة ٣: اسم الفرع النشط + مُبدّل الفروع (يظهر لو فيه فرعين أو أكتر)
  const clinics = Array.isArray(State.clinics) ? State.clinics : [];
  const active = clinics.find(c => c.id === State.activeClinicId);
  if (active) $('#sideClinicName').textContent = active.name || s.clinicName || SHELL_BRAND.clinic || 'عيادتي';
  const sel = $('#activeClinic');
  if (sel) {
    sel.innerHTML = clinics.length
      ? clinics.map(c => '<option value="' + esc(c.id) + '"' + (c.id === State.activeClinicId ? ' selected' : '') + '>'
          + esc(c.name || 'فرع') + (c.code ? ' (' + esc(c.code) + ')' : '') + '</option>').join('')
      : '<option value="">الفرع الافتراضي</option>';
    sel.classList.toggle('hide', clinics.length < 2);
  }
}
