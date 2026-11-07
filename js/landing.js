/**
 * ========================================
 * landing.js
 * الوظيفة: تعبئة صفحة العرض التسويقي من SITE (js/site-config.js):
 *          الأرقام، الأسعار، روابط واتساب، ومكان مشغّل الفيديو.
 * الاعتمادات: site-config.js
 *
 * لا تلمس أي شيء في التطبيق — تعمل فقط على landing.html / demo.html.
 * ======================================== */
'use strict';

(function () {
  if (typeof SITE === 'undefined') return;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ── ١) الأرقام والأسعار ──
  $$('[data-price-m]').forEach(el => { el.textContent = fmtEGP(SITE.priceMonthly); });
  $$('[data-price-y]').forEach(el => { el.textContent = fmtEGP(SITE.priceYearly); });
  $$('[data-trial]').forEach(el => { el.textContent = String(SITE.trialDays); });
  $$('[data-seats]').forEach(el => { el.textContent = String(SITE.foundingSeats); });

  // ── ٢) روابط واتساب ──
  $$('[data-wa]').forEach(el => { el.href = waLink(); });

  // ── ٣) الفيديو ──
  // الفيديو مكتوب في landing.html مباشرة (عشان يشتغل حتى لو JS اتأخر)،
  // وهنا بنزامن مصدره مع SITE — لو المسار اتغير من مكان واحد بس.
  const slot = $('#demoVideoSlot');
  if (slot) {
    const v = slot.querySelector('video');
    if (v) {
      if (SITE.demoVideo && v.getAttribute('src') !== SITE.demoVideo) {
        v.src = SITE.demoVideo;
      }
      if (SITE.demoPoster) v.poster = SITE.demoPoster;
    } else if (SITE.demoVideo) {
      // صفحة قديمة بلا عنصر video → نبنيه
      const nv = document.createElement('video');
      nv.controls = true;
      nv.playsInline = true;
      nv.preload = 'metadata';
      if (SITE.demoPoster) nv.poster = SITE.demoPoster;
      nv.src = SITE.demoVideo;
      nv.appendChild(document.createTextNode('متصفحك مش بيدعم تشغيل الفيديو.'));
      slot.innerHTML = '';
      slot.appendChild(nv);
    }
  }

  // ── ٤) تتبّع بسيط لضغطات الـCTA (بلا أي بيانات شخصية) ──
  $$('[data-cta]').forEach(el => {
    el.addEventListener('click', () => {
      // معرّف محلي فقط — لو حبيت تقيس لاحقًا من غير إرسال أي بيانات
      try { sessionStorage.setItem('lp_cta_' + el.dataset.cta, '1'); } catch (_) {}
    });
  });
})();
