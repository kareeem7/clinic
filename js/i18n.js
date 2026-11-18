/**
 * ========================================
 * js/i18n.js
 * الوظيفة: طبقة الترجمة. مفتاح الترجمة هو النص العربي نفسه — نمط gettext —
 *   يعني اللي مش مترجم بيرجع عربي بدل ما يظهر مفتاح غريب في وش المستخدم.
 *   الطبقة دي ما بتعرفش حاجة عن التطبيق: بتدير اللغة، الاتجاه، وتبديل نص
 *   العناصر اللي عليها data-i18n. النصوص اللي بيولّدها JS بتترجم وقت النداء.
 * الدوال الرئيسية: I18N.init، I18N.t، I18N.setLang، I18N.applyDom، I18N.on
 * الاعتمادات: lang-en.js (القاموس) — لازم يتحمّل قبله
 * آخر تعديل: 2026-11-18 — إضافة الطبقة للعرض بالإنجليزية
 * ========================================
 */
'use strict';

/* ============================================================
   ملاحظات تصميمية (اللي جاي ده كان نتيجة تجربة، مش أسلوب مفضّل):

   ١. المفتاح = النص العربي. لو استعملنا مفاتيح رمزية زي 'login.title'
      كان معناه قاموسين (عربي وإنجليزي) لكل نص، وضعف الشغل، وقاموس عربي
      بيتكرر فيه اللي مكتوب في الكود أصلاً. بالطريقة دي القاموس الإنجليزي
      بس، وأي نص لسه ما اترجمش بيفضل عربي — نقص واضح ومقيس، مش كلمة غريبة.

   ٢. الترجمة بتحصل وقت العرض مش وقت التحميل. الطبقة ما بتلمسش الأحداث
      ولا الحالة؛ بتغيّر النص والاتجاه وبس.

   ٣. عنصر فيه أبناء (زي <h3><i class="fa"></i> نص</h3>) بنترجم له
      عقد النص المباشرة بس، مش textContent — وإلا الأيقونة تتمسح.
   ============================================================ */

const I18N = {
  LANGS: ['ar', 'en'],
  lang: 'ar',
  dict: {},
  _listeners: [],
  _booted: false,

  // تهيئة: تقرأ اللغة المحفوظة، تضبط الاتجاه، وتركب مستمع زر التبديل
  init(dict) {
    this.dict = dict || {};
    let saved = null;
    try { saved = localStorage.getItem('clinic_lang'); } catch (e) { /* وضع خاص/تخزين مقفول */ }
    this.lang = this.LANGS.includes(saved) ? saved : 'ar';
    this.applyDir();
    this._booted = true;
    return this.lang;
  },

  // الترجمة الفعلية: key هو النص العربي، وvars لتعويض {placeholders}
  t(key, vars) {
    if (key == null) return '';
    const table = this.dict[this.lang];
    let out = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    if (vars) {
      out = String(out).replace(/\{(\w+)\}/g, (m, name) =>
        vars[name] != null ? String(vars[name]) : m);
    }
    return out;
  },

  isRTL() { return this.lang === 'ar'; },

  // <html dir> هو المصدر الوحيد للاتجاه — مفيش كلاس بيعمل نفس الشغل
  applyDir() {
    const rtl = this.isRTL();
    document.documentElement.lang = this.lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    // زر التبديل بيعرض اللغة التانية، مش الحالية — اللي بيدوّر على إنجليزي
    // مش عايز يقرأ «إنجليزي» وهو شايف عربي.
    document.querySelectorAll('[data-lang-toggle]').forEach(btn => {
      btn.textContent = rtl ? 'English' : 'العربية';
    });
  },

  setLang(lang) {
    if (!this.LANGS.includes(lang) || lang === this.lang) return this.lang;
    this.lang = lang;
    try { localStorage.setItem('clinic_lang', lang); } catch (e) { /* مش مشكلة */ }
    this.applyDir();
    this.applyDom(document);
    this._listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error('i18n listener', e); } });
    return this.lang;
  },

  toggle() { return this.setLang(this.lang === 'ar' ? 'en' : 'ar'); },

  onChange(fn) { if (typeof fn === 'function') this._listeners.push(fn); },

  /* يترجم أي عنصر عليه data-i18n.
     - data-i18n فاضي        → المفتاح هو نص العنصر وقت أول مرة
     - data-i18n="نص عربي"   → المفتاح هو القيمة دي (للعناصر اللي نصها بيتغير)
     - data-i18n-ph          → placeholder
     - data-i18n-title       → title
     - data-i18n-aria        → aria-label
     المفتاح بيتحفظ في dataset.i18nKey عشان التبديل التاني يلاقيه، حتى لو
     نص العنصر بقى إنجليزي. */
  applyDom(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      if (!el.dataset.i18nKey) {
        const explicit = el.getAttribute('data-i18n');
        el.dataset.i18nKey = (explicit && explicit.trim())
          ? explicit.trim()
          : this._directText(el).trim();
      }
      const key = el.dataset.i18nKey;
      if (!key) return;
      this._setDirectText(el, this.t(key));
    });

    scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
      if (!el.dataset.i18nPhKey) el.dataset.i18nPhKey = el.getAttribute('data-i18n-ph') || '';
      if (el.dataset.i18nPhKey) el.setAttribute('placeholder', this.t(el.dataset.i18nPhKey));
    });

    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
      if (!el.dataset.i18nTitleKey) el.dataset.i18nTitleKey = el.getAttribute('data-i18n-title') || '';
      if (el.dataset.i18nTitleKey) el.setAttribute('title', this.t(el.dataset.i18nTitleKey));
    });

    scope.querySelectorAll('[data-i18n-aria]').forEach(el => {
      if (!el.dataset.i18nAriaKey) el.dataset.i18nAriaKey = el.getAttribute('data-i18n-aria') || '';
      if (el.dataset.i18nAriaKey) el.setAttribute('aria-label', this.t(el.dataset.i18nAriaKey));
    });
  },

  // عقد النص المباشرة للعنصر (بدون اللي جوّه أبناء) — للـ <h3><i></i> نص</h3>
  _directText(el) {
    let out = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) out += n.nodeValue; });
    return out || el.textContent || '';
  },

  _setDirectText(el, text) {
    const textNodes = [...el.childNodes].filter(n => n.nodeType === 3);
    if (!textNodes.length) { el.textContent = text; return; }
    // نحافظ على المسافة الحوالين النص عشان الأيقونة ما تلزقش فيه
    const first = textNodes[0];
    first.nodeValue = ' ' + text + ' ';
    textNodes.slice(1).forEach(n => { n.nodeValue = ''; });
  }
};

/* زر تبديل اللغة — مستمع واحد على المستند، فما بيلزمش نربط كل زر لوحده
   ولا أي شاشة تتعدّل لما نضيف زرار جديد. */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-lang-toggle]');
  if (!btn) return;
  e.preventDefault();
  const next = I18N.toggle();
  // نصوص السيرفر (عناصر data-i18n) اتظبطت جوه setLang؛ اللي بيترسم بـJS
  // بيتنادى من المستمعين في main.js/archive.js
  document.dispatchEvent(new CustomEvent('clinic:lang', { detail: { lang: next } }));
});
