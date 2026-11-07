/**
 * ========================================
 * app-gate.js
 * الوظيفة: توجيه الزائر **الجديد** إلى صفحة العرض التسويقي، مع ضمان عدم
 *          حجب شاشة الدخول عن أي حد محتاجها.
 * الاعتمادات: لا شيء — يُحمَّل أول سكربت في index.html.
 *
 * قواعد الأمان (لا تُكسَر):
 *   ١) ?app=1 أو #app في الرابط → التطبيق دائمًا. لا استثناء.
 *   ٢) في جلسة سابقة على نفس التبويب (sessionStorage.clinic_doctor) → التطبيق.
 *   ٣) غير ذلك → landing.html.
 *   ٤) لو أي حاجة فشلت (sessionStorage ممنوع، خطأ) → **نبقى في التطبيق**،
 *      لأن قفل شاشة الدخول أخطر بكتير من عرض صفحة تسويقية.
 *   ٥) لا يُنفَّذ إطلاقًا على صفحة العرض نفسها، ولا يمس أي بيانات.
 * ======================================== */
'use strict';

(function () {
  function hasAppIntent() {
    try {
      if (/[?&]app=1\b/.test(location.search)) return true;
      if (location.hash === '#app') return true;
    } catch (_) { /* no-op */ }
    return false;
  }

  function hasSessionHint() {
    try {
      return Boolean(sessionStorage.getItem('clinic_doctor'));
    } catch (_) {
      // sessionStorage مقفول (وضع خاص/سياسات) → منعرفش، فنسيب المستخدم في التطبيق
      return true;
    }
  }

  function go() {
    if (hasAppIntent()) return;        // ١
    if (hasSessionHint()) return;      // ٢
    try {
      location.replace('landing.html'); // ٣ — replace عشان زر الرجوع ما يعلّقش
    } catch (_) {
      /* لو التحويل فشل لأي سبب، المستخدم يفضل في التطبيق — أأمن */
    }
  }

  go();
})();
