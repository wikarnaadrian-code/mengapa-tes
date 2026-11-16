// Halaman dashboard klien (mengapa.me/<klien>): cek klien di server sebelum halaman dikirim.
// - klien terdaftar & aktif: halaman login langsung dengan nama + logo, pratinjau WhatsApp per klien
// - tidak terdaftar / nonaktif: langsung "Halaman tidak ditemukan" (status 404)
// - kalau gagal membaca Sheet: kirim halaman biasa (browser mengecek sendiri seperti sebelumnya)
const fs = require('fs'), path = require('path');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const js = o => JSON.stringify(o).replace(/</g, '\\u003c');

async function baseHtml(req) {
  try { return fs.readFileSync(path.join(process.cwd(), 'klien.html'), 'utf8'); }
  catch (e) {
    const r = await fetch(`https://${req.headers.host}/klien`, { headers: { 'x-from': 'klienpage' } });
    return r.text();
  }
}
async function findClient(slug) {
  const url = (process.env.APPS_SCRIPT_URL || '').trim(), rt = (process.env.READ_TOKEN || '').trim();
  if (!url || !rt) throw new Error('env');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(rt) + '&tab=klien', { redirect: 'follow', signal: ctl.signal });
    const j = JSON.parse(await r.text());
    if (!Array.isArray(j.rows)) throw new Error('rows');
    return j.rows.find(x => String(x.klien || '').trim().toLowerCase() === slug.toLowerCase()) || null;
  } finally { clearTimeout(timer); }
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '').trim();
  let html;
  try { html = await baseHtml(req); } catch (e) { res.statusCode = 502; return res.end('Gagal memuat halaman'); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  let c;
  try { c = /^[A-Za-z0-9][A-Za-z0-9-]{1,38}[A-Za-z0-9]$/.test(slug) ? await findClient(slug) : null; }
  catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.end(html); } // gagal baca Sheet: halaman biasa
  const host = `https://${req.headers.host || 'www.mengapa.me'}`;
  if (!c || String(c.status || '').trim().toLowerCase() === 'nonaktif') {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.end(html.replace('<title>Dashboard</title>', `<title>Halaman tidak ditemukan · Mengapa</title>\n  <script>window.__KLIEN=${js({ found: false })}</script>`));
  }
  const nama = String(c.nama || c.klien), logo = /^https:\/\//.test(String(c.logo || '')) ? String(c.logo) : '';
  const img = logo || `${host}/og-admin-sq.png`;
  const meta = `<title>Dashboard · ${esc(nama)}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Dashboard ${esc(nama)} × Mengapa" />
  <meta property="og:description" content="Hasil Tes Karakter Lengkap tim ${esc(nama)} dalam satu dashboard." />
  <meta property="og:image" content="${esc(img)}" />
  <meta name="twitter:card" content="summary" />
  <script>window.__KLIEN=${js({ found: true, nama, logo })}</script>`;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.end(html.replace('<title>Dashboard</title>', meta));
};
