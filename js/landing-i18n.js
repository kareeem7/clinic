/* =====================================================================
   landing-i18n.js — تشغيل طبقة الترجمة على صفحة العرض
   ---------------------------------------------------------------------
   صفحة العرض مش بتعدّي على main.js، فمحدش بينادي applyLang() هناك.
   الملف ده بيعمل الحاجتين اللي main.js بيعملهم: يطبّق الترجمة أول ما
   الصفحة تجهز، ويعيدها كل مرة اللغة تتغير.

   العنوان ووصف الصفحة (title/meta) مش عناصر في الـbody، فـapplyDom
   مش بيوصلها — بنخزّن النص العربي الأصلي في dataset ونرجّعه وقت الحاجة.
   ===================================================================== */
'use strict';

(function () {
  if (typeof I18N === 'undefined') return;

  // العناصر اللي برّه الـbody: بنمسك النص العربي الأصلي مرة واحدة
  const META = [
    { sel: 'title', attr: null },
    { sel: 'meta[name="description"]', attr: 'content' },
    { sel: 'meta[property="og:title"]', attr: 'content' },
    { sel: 'meta[property="og:description"]', attr: 'content' }
  ];

  function readMeta(el, attr) {
    return attr ? el.getAttribute(attr) : el.textContent;
  }

  function writeMeta(el, attr, value) {
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  }

  function applyMeta() {
    META.forEach(m => {
      document.querySelectorAll(m.sel).forEach(el => {
        if (!el.dataset.i18nSrc) el.dataset.i18nSrc = readMeta(el, m.attr) || '';
        if (!el.dataset.i18nSrc) return;
        writeMeta(el, m.attr, I18N.t(el.dataset.i18nSrc));
      });
    });
  }

  function apply() {
    I18N.applyDom(document);
    applyMeta();
  }

  // الترجمة بتتطبق بعد أي تغيير للغة — نفس نقطة الاتصال اللي main.js بيستخدمها
  I18N.onChange(apply);

  function boot() {
    if (typeof I18N_EN !== 'undefined' && !I18N._booted) I18N.init({ en: I18N_EN });
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
