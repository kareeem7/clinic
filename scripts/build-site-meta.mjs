// Central generator: site.config.json → <head> of index.html/reset.html
// + robots.txt (+ sitemap.xml only when indexing is explicitly enabled).
// Run: npm run meta   (or: node scripts/build-site-meta.mjs)
// Idempotent: only the block between SITE-META markers is replaced.
// No secrets, no patient data, no inline JavaScript (CSP stays intact).
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const write = (f, s) => writeFileSync(new URL(f, root), s);
const cfg = JSON.parse(read('site.config.json'));

const START = '<!-- SITE-META:START -->';
const END = '<!-- SITE-META:END -->';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const site = (cfg.siteUrl || '').replace(/\/+$/, '');
// og:image must be an absolute URL: WhatsApp/Facebook do not resolve data: URIs.
// Until the real Worker domain is put in siteUrl, a stable CDN URL is used.
const image = site ? site + '/preview.png' : cfg.previewImage;
if (!/^https:\/\//.test(image)) throw new Error('og:image must be an absolute https URL');

function blockFor(page) {
  const p = (cfg.pages && cfg.pages[page]) || {};
  const title = p.title || cfg.title;
  const description = p.description || cfg.description;
  const robots = p.robots || cfg.robots;
  const lines = [
    `<title>${esc(title)}</title>`,
    `<link rel="icon" href="${esc(cfg.favicon)}" type="image/svg+xml">`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="theme-color" content="${esc(cfg.themeColor)}">`,
    `<meta name="robots" content="${esc(robots)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(cfg.product)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:locale" content="${esc(cfg.locale)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:secure_url" content="${esc(image)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${Number(cfg.previewWidth)}">`,
    `<meta property="og:image:height" content="${Number(cfg.previewHeight)}">`,
    `<meta property="og:image:alt" content="${esc(title)}">`,
    `<meta name="twitter:card" content="${esc(cfg.twitterCard)}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`
  ];
  if (site) {
    const url = p.canonical || site + '/' + (page === 'index.html' ? '' : page);
    lines.push(`<link rel="canonical" href="${esc(url)}">`);
    lines.push(`<meta property="og:url" content="${esc(url)}">`);
  }
  return `${START}\n${lines.join('\n')}\n${END}`;
}

for (const page of ['index.html', 'reset.html']) {
  const html = read(page);
  const rx = new RegExp(START + '[\\s\\S]*?' + END);
  if (!rx.test(html)) throw new Error(`${page}: SITE-META markers missing`);
  const next = html.replace(rx, blockFor(page));
  if (next !== html) write(page, next);
}

// Private medical app: crawlers may read the page (so the noindex meta is
// seen), but the password-recovery endpoint is never indexed. A sitemap is
// emitted only after allowIndexing = true and a real siteUrl is configured.
write('robots.txt', [
  '# ملفات تشغيل ونشر — ليست جزءاً من الموقع المنشور',
  'User-agent: *',
  'Allow: /',
  'Disallow: /reset.html',
  'Disallow: /tests/',
  'Disallow: /sql/',
  'Disallow: /supabase/',
  'Disallow: /docs/',
  'Disallow: /scripts/',
  'Disallow: /.github/',
  ''
].join('\n'));

const sitemap = new URL('sitemap.xml', root);
if (cfg.allowIndexing && site) {
  write('sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${esc(site)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
    `</urlset>\n`);
} else if (existsSync(sitemap)) {
  unlinkSync(sitemap);
}

console.log(`site meta regenerated from site.config.json (og:image → ${image})`);
