/* =====================================================================
   sw.js — الدفعة ١ من الأوفلاين: نسخة من الموقع على الجهاز
   ---------------------------------------------------------------------
   * يُخزّن ملفات الواجهة فقط (HTML/CSS/JS + مكتبات CDN المقيدة بـ SRI).
   * 🚫 لا يُخزّن ولا يتدخل أبداً في أي طلب لـ supabase.co:
     دي طلبات فيها بيانات مرضى وتوكنات، ولازم تروح للشبكة مباشرة.
   * لازم أول زيارة تكون بالنت عشان النسخة تتنزّل، وفوق HTTPS فقط.
   * أي تغيير في ملفات الواجهة → ارفع رقم CACHE_NAME.
   ===================================================================== */
'use strict';

const CACHE_NAME = 'clinic-shell-v3';

const SHELL = [
  './',
  './index.html',
  './reset.html',
  './css/admin.css',
  './css/appointments.css',
  './css/auth.css',
  './css/base.css',
  './css/components.css',
  './css/dashboard.css',
  './css/landing.css',
  './css/layout.css',
  './css/main.css',
  './css/mfa-setup.css',
  './css/overlays.css',
  './css/patient-profile.css',
  './css/patients.css',
  './css/plans.css',
  './css/portal.css',
  './css/responsive.css',
  './css/settings.css',
  './css/variables.css',
  './css/whatsapp.css',
  './js/admin.js',
  './js/app.js',
  './js/appointments.js',
  './js/archive.js',
  './js/config.js',
  './js/dashboard.js',
  './js/db.js',
  './js/defaults.js',
  './js/export.js',
  './js/health-monitoring.js',
  './js/labs.js',
  './js/main.js',
  './js/message-style.js',
  './js/notes.js',
  './js/offline-capture.js',
  './js/offline-snapshot.js',
  './js/offline.js',
  './js/patient-portal.js',
  './js/patient.js',
  './js/patients.js',
  './js/plans.js',
  './js/reset.js',
  './js/settings.js',
  './js/state.js',
  './js/utils.js',
  './js/landing.js',
  './js/site-config.js',
  './js/whatsapp.js'
];

// مكتبات خارجية: أحسن جهد (فشل واحدة ما يوقّعش تثبيت الـ SW كله)
const OPTIONAL = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL);
    await Promise.allSettled(OPTIONAL.map(u => cache.add(new Request(u, { mode: 'cors' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // الكتابة ما تتمسكش أبداً
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // بيانات المرضى والتوكنات: لا كاش ولا تدخل، تروح للشبكة مباشرة (وتفشل لو مفيش نت)
  if (/(^|\.)supabase\.co$/i.test(url.hostname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstShell(req, url));
    return;
  }
  event.respondWith(cacheFirstAsset(req, url));
});

async function networkFirstShell(req, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      await cache.put(req, fresh.clone());
      // نحدّث نسخة الصفحة الرئيسية بس لو الطلب هو الرئيسي،
      // وإلا reset.html هيتخزّن مكانها ويظهر أوفلاين بالغلط
      const main = url.pathname === '/' || /\/index\.html$/i.test(url.pathname);
      if (main) await cache.put('./index.html', fresh.clone());
    }
    return fresh;
  } catch (_) {
    return (await cache.match(req)) || (await cache.match('./index.html')) ||
      (await cache.match('./')) || offlinePage();
  }
}

async function cacheFirstAsset(req, url) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    const cacheable = url.origin === self.location.origin || url.host === 'cdn.jsdelivr.net';
    if (res && res.ok && cacheable) await cache.put(req, res.clone());
    return res;
  } catch (_) {
    if (hit) return hit;
    if (url.origin === self.location.origin && /\.html?$/.test(url.pathname)) {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

function offlinePage() {
  return new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' +
    '<title>بدون اتصال</title><body style="font-family:sans-serif;padding:24px">' +
    '<h2>النسخة المحفوظة لسه ما اتحمّلتش</h2>' +
    '<p>افتح الموقع مرة واحدة والنت شغّال، وبعدين هيفتح معاك حتى لو النت قطع.</p>' +
    '</body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
