/**
 * ========================================
 * utils.js
 * الوظيفة: الأدوات المساعدة العامة: المحددات $/$$، تنقية النصوص esc، تواريخ بصيغ مصرية، أرقام، تطبيع التليفون المصري وفتح واتساب، تعريب أخطاء المصادقة، Toast، المودالات ونوافذ التأكيد والإدخال.
 * الدوال/الكيانات الرئيسية: normPhoneEG، openWA، authErrorAr، explainError، toast، openModal، closeModal، confirmDlg، promptDlg، $$، uid، esc، MONTHS، DAYS_S …وغيرها
 * الاعتمادات: config.js (logError)
 * آخر تعديل: 2026-10-31 — تقسيم من index.html الموحد (الكود منسوخ حرفياً وبلا أي تغيير)
 * ========================================
 */
'use strict';

/* ============================================================
   js/utils.js — أدوات مساعدة عامة
   ============================================================ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// تنقية النصوص قبل عرضها في HTML (حماية من الحقن)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---- التواريخ ----
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DAYS   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const DAYS_S = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];

const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => isoOf(new Date());
const addDaysISO = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const monthsAgoISO = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoOf(d); };

const humanDate = s => { const d = parseISO(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const longDate  = d => DAYS[d.getDay()] + '، ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
const relDay = s => {
  const diff = Math.round((parseISO(s) - parseISO(todayISO())) / 86400000);
  if (diff === 0) return 'اليوم'; if (diff === 1) return 'غداً'; if (diff === -1) return 'أمس';
  return DAYS[parseISO(s).getDay()] + ' ' + humanDate(s);
};
// بداية الأسبوع: السبت (المتبع في مصر)
const weekStartISO = iso => { const d = parseISO(iso); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return isoOf(d); };
// تحويل الوقت 24س إلى صيغة 12س عربية: "17:30" → "5:30 م"
const fmtTime = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const s = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12; return h + ':' + pad(m) + ' ' + s; };
const fmtNum = n => Number(n || 0).toLocaleString('en-US');

// ---- واتساب: تطبيع الرقم المصري وفتح المحادثة (المرحلة 8) ----
function normPhoneEG(ph) {
  let d = String(ph || '').replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(2);
  if (d.startsWith('0')) d = '2' + d;                       // 010... → 2010...
  else if (!d.startsWith('20') && d.length === 10) d = '20' + d; // 10... → 2010...
  return d;
}
function openWA(phone, msg) {
  if (!phone) return toast('لا يوجد رقم موبايل لهذا المريض', 'error');
  window.open('https://wa.me/' + normPhoneEG(phone) + '?text=' + encodeURIComponent(msg), '_blank');
}

// رسالة واحدة واضحة لأخطاء «المخطط مش محدّث» — بدل «حدث خطأ غير متوقع»
// (PostgREST بيرجع PGRST205/PGRST204/PGRST202 لما جدول/عمود/دالة تكون ناقصة)
// الترحيلات مطبّقة فعلاً على clinicv2 ← الرسالة بتوجّه لإدارة النظام،
// مش بتطلب من المستخدم تطبيق SQL من الواجهة (الواجهة أصلاً بلا SQL).
const SCHEMA_HINT = 'تعذّر قراءة بيانات العيادة — حدّث الصفحة، ولو تكرّر الخطأ تواصل مع إدارة النظام من غير أي تغيير في قاعدة البيانات';

// ترجمة أكواد أخطاء Supabase Auth إلى رسائل عربية واضحة للدكتور
function authErrorAr(code) {
  const M = {
    'auth/invalid-credential':     'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/user-not-found':         'لا يوجد حساب بهذا البريد — أنشئ حساباً جديداً من تبويب «حساب جديد»',
    'auth/wrong-password':         'كلمة المرور غير صحيحة — أعد المحاولة',
    'auth/email-already-in-use':   'هذا البريد مسجّل بالفعل — سجّل الدخول بدلاً من إنشاء حساب',
    'auth/weak-password':          'كلمة المرور ضعيفة — استخدم 6 أحرف على الأقل',
    'auth/invalid-email':          'صيغة البريد الإلكتروني غير صحيحة',
    'auth/network-request-failed': 'تعذّر الاتصال بالخادم — تحقق من الإنترنت',
    'auth/too-many-requests':      'محاولات كثيرة متتالية — انتظر دقيقة ثم أعد المحاولة',
    // أكواد أخطاء Supabase Auth الشائعة
    'invalid_credentials':         'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'user_already_exists':         'هذا البريد مسجّل بالفعل — سجّل الدخول بدلاً من إنشاء حساب',
    'weak_password':               'كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل',
    'email_not_confirmed':         'فعّل حسابك أولاً من رسالة التأكيد المرسلة لبريدك',
    'over_request_rate_limit':     'محاولات كثيرة متتالية — انتظر قليلاً ثم أعد المحاولة',
    'confirm-email':               'تم إنشاء حسابك! فعّله من رسالة التأكيد في بريدك ثم سجّل الدخول — سيُجهَّز ملف العيادة تلقائياً عند أول دخول (أو عطّل «Confirm email» من إعدادات Auth للدخول الفوري)',
    'demo-mode':                   'استعادة كلمة المرور تتطلب ربط Supabase',
    // Phase 1 + 10: حالات الاشتراك والإدارة والتحقق بخطوتين
    'account_suspended':           'تم تعليق اشتراك العيادة — تواصل مع إدارة النظام لتجديد الاشتراك',
    'account_deleted':             'هذا الحساب تم حذفه — تواصل مع الدعم لاستعادته إن كان بالخطأ',
    'account_expired':             'انتهت فترة الاشتراك — جدد اشتراكك من إدارة النظام للمتابعة',
    'clinic_profile_missing':      'تعذّر العثور على ملف العيادة أو الوصول إليه لهذا الحساب — تواصل مع إدارة النظام',
    '42501':                       'لا توجد صلاحية كافية لتحميل البيانات — تواصل مع إدارة النظام',
    'not_admin':                   'هذا الحساب ليس حساب إدارة نظام — الحسابات المصرّح لها فقط تدخل',
    'invalid_totp':                'كود التحقق غير صحيح — تأكد من ضبط الوقت على جهازك وأعد المحاولة',
    'mfa_no_factor':               'لا يوجد مُعرّف تحقق مسجّل — سجّل الدخول مجدداً',
    // أكواد GoTrue الحقيقية للتحقق بخطوتين. قبل إضافتها كان أي فشل بعد كتابة
    // الكود يُترجم خطأً إلى «حدث خطأ غير متوقع»، فلا يعرف الدكتور ماذا يفعل.
    'mfa_verification_failed':     'كود التحقق غير صحيح أو استُخدم بالفعل — انتظر الرمز الجديد في تطبيق المصادقة ثم أعد المحاولة',
    'mfa_challenge_expired':       'انتهت صلاحية رمز التحقق — اكتب الرمز الجديد الظاهر في تطبيق المصادقة وأعد المحاولة',
    'mfa_verification_rejected':   'تم رفض التحقق بخطوتين — أعد المحاولة بعد لحظات أو سجّل الدخول من جديد',
    'mfa_ip_address_mismatch':     'تغيّرت شبكة الإنترنت أثناء التحقق — ارجع لنفس الشبكة وسجّل الدخول من جديد',
    'mfa_factor_not_found':        'لم يُعثر على تطبيق المصادقة المرتبط بهذا الحساب — تواصل مع إدارة النظام',
    'mfa_totp_verify_not_enabled': 'التحقق بخطوتين (TOTP) غير مفعّل في إعدادات Supabase — افتح لوحة المشروع ← Authentication ← Sign In / Providers ← فعّل «TOTP / Multi-Factor Authentication»، ثم حدّث الصفحة',
    'mfa_totp_enroll_not_enabled': 'تسجيل تطبيق المصادقة غير مفعّل في إعدادات Supabase — فعّل TOTP من لوحة المشروع ← Authentication، ثم حدّث الصفحة',
    'mfa_verified_factor_exists':  'تطبيق المصادقة مسجّل بالفعل — سجّل الدخول واكتب الرمز',
    'too_many_enrolled_mfa_factors': 'تم بلوغ الحد الأقصى لتطبيقات المصادقة — تواصل مع إدارة النظام',
    'insufficient_aal':            'لازم إكمال التحقق بخطوتين أولاً — سجّل الدخول من جديد واكتب الرمز',
    'session_not_found':           'انتهت جلسة الدخول — سجّل الدخول من جديد واكتب رمزاً جديداً',
    'reauthentication_needed':     'انتهت صلاحية الجلسة — سجّل الدخول من جديد',
    'otp_expired':                 'انتهت صلاحية الرمز — اطلب رمزاً جديداً وأعد المحاولة',
    'validation_failed':           'الرمز المدخل غير مقبول — تأكد أنه 6 أرقام من تطبيق المصادقة',
    // ترحيلات ناقصة (جدول/عمود/دالة مش موجودة في الـ schema cache)
    'PGRST205': SCHEMA_HINT,
    'PGRST204': SCHEMA_HINT,
    'PGRST202': SCHEMA_HINT,
    'PGRST200': SCHEMA_HINT,
    '42P01':    SCHEMA_HINT,
    '42703':    SCHEMA_HINT,
    '42883':    SCHEMA_HINT
  };
  return M[code] || 'حدث خطأ غير متوقع — حدّث الصفحة وأعد المحاولة، ولو تكرّر تواصل مع إدارة النظام';
}

// Central error explainer: Supabase error codes + message fallbacks, all in clear Arabic.
// Errors are always reduced to a safe message — never echo raw server payloads to the user.
function explainError(ex) {
  const code = (ex && ex.code) || '';
  const msg = (ex && ex.message) || '';
  const direct = authErrorAr(code);
  if (direct && !direct.startsWith('حدث خطأ غير متوقع')) return direct;
  if (/Could not find the table|Could not find the function|schema cache|relation .* does not exist|column .* does not exist|function .* does not exist/i.test(msg)) return SCHEMA_HINT;
  if (/Invalid login credentials/i.test(msg)) return authErrorAr('invalid_credentials');
  // GoTrue أحياناً يُرجع الرسالة بلا error_code صالح — نترجم النص نفسه كشبكة أمان.
  if (/Invalid TOTP|Invalid MFA|Invalid verification code|Invalid code entered/i.test(msg)) return authErrorAr('invalid_totp');
  if (/MFA challenge .*expired|challenge .*expired|challenge_expired/i.test(msg)) return authErrorAr('mfa_challenge_expired');
  if (/IP addresses? mismatch|IP address.*mismatch/i.test(msg)) return authErrorAr('mfa_ip_address_mismatch');
  if (/MFA verification is disabled|verify is not enabled/i.test(msg)) return authErrorAr('mfa_totp_verify_not_enabled');
  if (/AAL2 required|insufficient.*aal/i.test(msg)) return authErrorAr('insufficient_aal');
  if (/Auth session missing|session_not_found|session.*(not found|expired|missing)|JWT expired|refresh.*(expired|invalid)|invalid.*refresh token/i.test(msg)) return authErrorAr('session_not_found');
  if (/Email not confirmed/i.test(msg)) return authErrorAr('email_not_confirmed');
  if (/forbidden/i.test(msg)) return 'ليس لديك صلاحية لهذا الإجراء';
  if (/violates foreign key|23503/i.test(msg)) return 'عملية غير مكتملة: العنصر مرتبط ببيانات غير متوافقة';
  if (/Failed to fetch|NetworkError|network request/i.test(msg)) return 'تعذّر الاتصال بالخادم — تحقق من الإنترنت وأعد المحاولة';
  // رقم المرجع يُربط بين ما يراه الدكتور وسطر console.error الفني، بلا أي بيانات مرضى.
  const requestId = logError(ex, 'unmapped');
  return authErrorAr(null) + (requestId ? ' (رقم المرجع: ' + requestId + ')' : '');
}

// ---- الصور الرمزية والألوان ----
const AV_COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];
const avatarColor = name => AV_COLORS[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const initials = name => { const p = String(name).trim().split(/\s+/); return (p[0]?.[0] || '') + (p[1]?.[0] || ''); };

// ---- التنبيهات (Toast) ----
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  // (بند 30) الأيقونة زخرفية — النص وحده هو اللي يتعلن (الحاوية #toastRoot عليها aria-live)
  t.innerHTML = '<i aria-hidden="true" class="fa-solid fa-' + (type === 'success' ? 'circle-check' : type === 'error' ? 'circle-exclamation' : 'circle-info') + '"></i><span>' + esc(msg) + '</span>';
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ---- المودالات ----
let _modalOnClose = null; // استدعاء عند إغلاق المودال (للتأكيدات)
let _modalPrevFocus = null; // (بند 30) العنصر اللي كان مركّز قبل الفتح — بنرجّعه عند الإغلاق
function openModal(title, bodyHTML, maxW = 560) {
  _modalPrevFocus = document.activeElement;
  // (بند 30) aria-labelledby بيربط عنوان الحوار بالقارئ + aria-label لزر الإغلاق الأيقوني
  $('#modalRoot').innerHTML =
    '<div class="modal-overlay"><div class="modal" style="max-width:' + maxW + 'px" role="dialog" aria-modal="true" aria-labelledby="modalTitle">' +
      '<div class="modal-head"><h3 id="modalTitle">' + title + '</h3><button class="icon-btn" data-close title="إغلاق" aria-label="إغلاق النافذة"><i aria-hidden="true" class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="modal-body">' + bodyHTML + '</div></div></div>';
  document.body.style.overflow = 'hidden';
  // (بند 30) focus trap: Tab/Shift+Tab يدوروا جوه المودال فقط — مفيش تسريب للخلفية
  const m = $('#modalRoot .modal');
  m.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0));
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !m.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !m.contains(cur))) { e.preventDefault(); first.focus(); }
  });
  // (بند 30) التركيز يبدأ من أول عنصر إدخال/زر في المحتوى، وإلا فزر الإغلاق
  const firstEl = m.querySelector('.modal-body input:not([type="hidden"]), .modal-body select, .modal-body textarea, .modal-body button') ||
                  m.querySelector('.modal-head .icon-btn');
  if (firstEl) firstEl.focus();
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
  document.body.style.overflow = '';
  // (بند 30) إرجاع التركيز لمكانه قبل المودال (بعد X أو Escape أو الحفظ)
  if (_modalPrevFocus && document.contains(_modalPrevFocus) && typeof _modalPrevFocus.focus === 'function') {
    try { _modalPrevFocus.focus(); } catch (e) { /* العنصر اختفى من الـDOM — نتجاهل بأمان */ }
  }
  _modalPrevFocus = null;
  if (_modalOnClose) { const f = _modalOnClose; _modalOnClose = null; f(); }
}
// نافذة تأكيد (مثل تأكيد الحذف) — ترجع Promise<boolean>
function confirmDlg(title, text, okText = 'تأكيد') {
  return new Promise(res => {
    openModal(title,
      '<p class="muted" style="font-weight:600">' + text + '</p>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-close>تراجع</button>' +
      '<button class="btn btn-danger" id="cfOk"><i class="fa-solid fa-trash"></i> ' + okText + '</button></div>', 440);
    _modalOnClose = () => res(false);
    $('#cfOk').onclick = () => { _modalOnClose = null; closeModal(); res(true); };
  });
}

// نافذة إدخال نص (كلمة سر مثلاً): تُرجع المكتوب أو null عند الإلغاء
function promptDlg(title, text, placeholder = '', type = 'password') {
  return new Promise(res => {
    openModal(title,
      '<p class="muted" style="font-weight:600">' + text + '</p>' +
      '<input class="input ltr" id="prVal" type="' + type + '" placeholder="' + esc(placeholder) + '" autocomplete="off" style="margin-top:10px">' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-close>إلغاء</button>' +
      '<button class="btn btn-primary" id="prOk"><i class="fa-solid fa-check"></i> تأكيد</button></div>', 440);
    _modalOnClose = () => res(null);
    $('#prVal').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#prOk').click(); } });
    $('#prOk').onclick = () => { const v = $('#prVal').value; _modalOnClose = null; closeModal(); res(v); };
    setTimeout(() => $('#prVal').focus(), 120);
  });
}

