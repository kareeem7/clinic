/**
 * ========================================
 * config.js — إعدادات المتصفح فقط (لا يحتوي على SQL التأسيس)
 * ----------------------------------------
 * الوظيفة: عنوان مشروع Supabase + مفتاح anon العام + ثوابت التجربة
 *          + توليد معرف الطلب + تسجيل الأخطاء المركزي.
 * الاعتمادات: لا شيء — أول ملف يتحمل في index.html و reset.html
 *
 * ⚠️ مخطط قاعدة البيانات الكامل انتقل إلى sql/baseline.sql (مصدر واحد،
 *    خارج الأصول المنشورة). لا تُعد إدخال أي SQL في حزمة المتصفح:
 *    أي زائر يقدر يقرأ ملفات js/ حتى لو الشاشة مخفية بـ hidden.
 * ⚠️ هنا مفتاح anon فقط (عام بحكم التصميم وتحميه سياسات RLS).
 *    ممنوع إطلاقاً service_role أو أي سر Supabase/Cloudflare في مجلد js/.
 * ========================================
 */
'use strict';

/* ============================================================
   إعدادات Supabase (Database + Auth)
   ------------------------------------------------------------
   التثبيت من الصفر: نفّذ sql/baseline.sql مرة واحدة في Supabase
   ← SQL Editor، ثم اضبط Project URL و anon public key هنا.
   ⚠️ 2026-11-06: مشروع Supabase السابق اتحذف نهائياً، فكان أي طلب
   بيرجع Failed to fetch ← «غير متصل بالخادم». الربط دلوقتي على المشروع
   الحي clinicv3 / xfppempsztxidjmlwrza (مفتاح anon العام، لا أسرار هنا).
   لا توجد شاشة تطلب من المستخدم لصق مفاتيح داخل كود الصفحة،
   ولا يُعرض أي SQL أو اسم جدول في واجهة الإنتاج.
   ============================================================ */
const supabaseConfig = {
  url: "https://xfppempsztxidjmlwrza.supabase.co", // Project URL — لا تضف /rest/v1
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmcHBlbXBzenR4aWRqbWx3cnphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MjkzOTYsImV4cCI6MjEwOTUwNTM5Nn0.6TiTOJbWCmVmn7ZaTD8pSSfBLc2eeDcWRX8G4cj7g54"   // ← anon public key فقط (آمن للعرض — الحماية بسياسات RLS)
};
const SUPABASE_READY = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
// Free trial window granted to every new signup. The super admin may change
// this later from system_settings; old clinics keep whatever rule applied then.
const TRIAL_DAYS = 14;

/* قيم الهوية المحايدة: تُستبدل بعد الدخول من State.settings / جدول clinics.
   لا توجد أسماء عيادات أو أطباء أو أرقام هواتف ثابتة في كود الإنتاج. */
const APP_BRAND = Object.freeze({
  product: 'عيادتي',
  clinic: 'عيادتي',
  doctor: 'الدكتور',
  admin: 'مدير النظام',
  adminPanel: 'إدارة النظام',
  systemName: 'منظومة عيادتي',
  patientClinic: 'عيادتك',
  tagline: 'مرضاك، مواعيدك، وخططك في مكان واحد'
});

/* Correlation id attached to every error report and audit row.
   It contains no patient data, so it is safe to show to the user
   and to keep in logs. */
let REQUEST_SEQ = 0;
function newRequestId() {
  REQUEST_SEQ += 1;
  return 'req-' + Date.now().toString(36) + '-' + REQUEST_SEQ;
}

/* Central error reporting. PHI (names, phones, weights, diagnoses,
   notes) is never written to the console or to any log sink. Raw server
   messages are deliberately NOT logged: PostgREST/GoTrue can echo row
   values, and a doctor's browser console is not a safe PHI sink. */
function errorShape(err) {
  const msg = String((err && err.message) || '');
  if (/Failed to fetch|NetworkError|network request|AuthRetryableFetchError/i.test(msg)) return 'network';
  if (/session.*(missing|expired|not found)|refresh.*(expired|invalid)|JWT expired/i.test(msg)) return 'session';
  if (/challenge.*expired/i.test(msg)) return 'mfa-challenge-expired';
  if (/Invalid TOTP|Invalid MFA|Invalid code entered/i.test(msg)) return 'mfa-code';
  if (/IP addresses? mismatch/i.test(msg)) return 'mfa-ip';
  if (/schema cache|Could not find the (table|function)|does not exist/i.test(msg)) return 'schema';
  if (/row-level security|permission denied|forbidden/i.test(msg)) return 'rls';
  if (/violates foreign key|23503|unique constraint|23505/i.test(msg)) return 'constraint';
  if (/Cannot read propert|is not a function|undefined/i.test(msg)) return 'client-typeerror';
  return msg ? 'other' : 'no-message';
}
function logError(err, context) {
  const requestId = newRequestId();
  const code = (err && (err.code || err.status)) || 'unknown';
  const name = (err && err.name) || 'unknown';
  const status = (err && err.status) || null;
  // Only a bounded technical shape is logged: no message, no payload, no PHI.
  console.error('[clinic]', { requestId, context, code, name, status, shape: errorShape(err) });
  return requestId;
}

// SQL التأسيس: sql/baseline.sql — لا يُحمّل ولا يُنسخ إلى المتصفح إطلاقاً.
