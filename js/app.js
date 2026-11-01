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
  if (State.isAdmin) {
    document.querySelector('.side-brand strong').textContent = 'إدارة النظام';
    $('#sideClinicName').textContent = 'منظومة عيادتي';
    $('#sideDoctor').textContent = 'مدير النظام';
    $('#sideAvatar').textContent = 'أ';
    return;
  }
  const s = State.settings;
  document.querySelector('.side-brand strong').textContent = 'عيادتي';
  $('#sideClinicName').textContent = s.clinicName || 'عيادتي';
  $('#sideDoctor').textContent = s.doctorName || 'الدكتور';
  $('#sideAvatar').textContent = (s.doctorName || 'د').replace('د.', '').trim()[0] || 'د';
}
