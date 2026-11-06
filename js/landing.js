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
  const slot = $('#demoVideoSlot');
  if (slot && SITE.demoVideo) {
    const v = document.createElement('video');
    v.controls = true;
    v.playsInline = true;
    v.preload = 'metadata';
    if (SITE.demoPoster) v.poster = SITE.demoPoster;
    const src = document.createElement('source');
    src.src = SITE.demoVideo;
    src.type = 'video/mp4';
    v.appendChild(src);
    v.appendChild(document.createTextNode('متصفحك مش بيدعم تشغيل الفيديو.'));
    slot.innerHTML = '';
    slot.appendChild(v);
  }

  // ── ٤) تتبّع بسيط لضغطات الـCTA (بلا أي بيانات شخصية) ──
  $$('[data-cta]').forEach(el => {
    el.addEventListener('click', () => {
      // معرّف محلي فقط — لو حبيت تقيس لاحقًا من غير إرسال أي بيانات
      try { sessionStorage.setItem('lp_cta_' + el.dataset.cta, '1'); } catch (_) {}
    });
  });
})();
