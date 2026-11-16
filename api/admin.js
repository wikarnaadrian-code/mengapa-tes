// Ruang Admin Mengapa: login + baca data dari Google Sheet (lewat Apps Script doGet).
// Env var di Vercel:
//   APPS_SCRIPT_URL  (sudah ada)
//   SHEET_SECRET     (sudah ada, dipakai juga untuk menandatangani sesi login)
//   READ_TOKEN       harus SAMA dengan Script Property READ_TOKEN di Apps Script
//   ADMIN_USER       opsional, default "admin"
//   ADMIN_PASSWORD   wajib, kata sandi masuk Ruang Tim
const crypto = require('crypto');

const SESSION_HOURS = 12;
const sign = (payload, key) => crypto.createHmac('sha256', key).update(payload).digest('base64url');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeSession(user, key, client) {
  const payload = Buffer.from(JSON.stringify({ u: user, c: client || '', exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return payload + '.' + sign(payload, key);
}
function readSession(tok, key) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !sig || !safeEq(sig, sign(payload, key))) return null;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return d.exp > Date.now() ? d : null; } catch (e) { return null; }
}

async function readTab(url, readToken, tab) {
  const u = url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(readToken) + (tab ? '&tab=' + tab : '');
  const r = await fetch(u, { redirect: 'follow' });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Apps Script tidak membalas JSON'); }
  if (!Array.isArray(j.rows)) throw new Error('READ_TOKEN belum cocok');
  return j.rows;
}

// Vercel Blob untuk logo klien (env BLOB_READ_WRITE_TOKEN terpasang otomatis saat Blob dihubungkan ke project)
const blobApi = () => globalThis.__blobMock || require('@vercel/blob');
const isBlobUrl = u => /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(String(u || '')) || (globalThis.__blobMock && /\/__blob\//.test(String(u || '')));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const key = (process.env.SHEET_SECRET || '').trim();
  const readToken = (process.env.READ_TOKEN || '').trim();
  const adminUser = (process.env.ADMIN_USER || 'admin').trim();
  const adminPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!url || !key) return res.status(500).json({ ok: false, error: 'APPS_SCRIPT_URL / SHEET_SECRET belum diisi di Vercel' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) { body = {}; }
  body = body || {};

  const low = v => String(v || '').trim().toLowerCase();
  const tokenList = v => String(v || '').split(/[,;\n]/).map(t => t.trim()).filter(Boolean);
  // Kolom yang boleh dilihat klien (tanpa WA, catatan internal, lokasi, dsb.)
  const T4 = ['sanguinis', 'koleris', 'melankolis', 'plegmatis'];
  const CLIENT_FIELDS = ['id', 'nama', 'usia', 'tanggal_lahir', 'waktu_iso', 'tanggal_tes', 'token', 'jawaban', 'durasi_detik', 'sumber_data',
    ...T4.flatMap(t => [t + '_kekuatan', t + '_kelemahan', t + '_sifat_kekuatan', t + '_sifat_kelemahan'])];
  async function findClient(slug) {
    if (!readToken) throw new Error('READ_TOKEN belum diisi di Vercel');
    const rows = await readTab(url, readToken, 'klien');
    return rows.find(r => low(r.klien) === low(slug));
  }

  // ---------- login & data untuk klien perusahaan ----------
  if (body.client) {
    try {
      if (body.action === 'info') {
        const c = await findClient(body.client);
        if (!c || low(c.status) === 'nonaktif') return res.status(200).json({ ok: false, error: 'notfound' });
        return res.status(200).json({ ok: true, nama: c.nama || c.klien, logo: c.logo || '' });
      }
      if (body.action === 'login') {
        const c = await findClient(body.client);
        if (c && low(c.status) === 'nonaktif') { await wait(600); return res.status(200).json({ ok: false, error: 'Akun klien ini sedang tidak aktif. Hubungi tim Mengapa.' }); }
        const ok = c && c.password && safeEq(low(body.user), low(c.username)) && safeEq(String(body.pass || ''), String(c.password));
        if (!ok) { await wait(900); return res.status(200).json({ ok: false, error: 'Username atau password salah' }); }
        return res.status(200).json({ ok: true, session: makeSession(c.username, key, low(c.klien)), hours: SESSION_HOURS, nama: c.nama || c.klien, logo: c.logo || '' });
      }
      if (body.action === 'data') {
        const sess = readSession(body.session, key);
        if (!sess || !sess.c || sess.c !== low(body.client)) return res.status(401).json({ ok: false, error: 'sesi' });
        const c = await findClient(sess.c);
        if (!c || low(c.status) === 'nonaktif') return res.status(401).json({ ok: false, error: 'sesi' });
        const toks = tokenList(c.token);
        const [baru, lama] = await Promise.all([readTab(url, readToken, ''), readTab(url, readToken, 'lama').catch(() => [])]);
        const hasil = [...baru, ...lama.filter(r => r.sumber_data === 'web lama')].filter(r => toks.includes(String(r.token || '').trim()))
          .map(r => Object.fromEntries(CLIENT_FIELDS.map(k => [k, r[k] || ''])));
        return res.status(200).json({ ok: true, hasil, mini: [], mindset: [], nama: c.nama || c.klien, logo: c.logo || '', at: new Date().toISOString() });
      }
    } catch (e) { return res.status(502).json({ ok: false, error: String(e.message || e) }); }
    return res.status(400).json({ ok: false, error: 'action' });
  }

  if (body.action === 'login') {
    if (!adminPass) return res.status(500).json({ ok: false, error: 'ADMIN_PASSWORD belum diisi di Vercel' });
    const ok = safeEq(String(body.user || '').trim().toLowerCase(), adminUser.toLowerCase()) && safeEq(String(body.pass || ''), adminPass);
    if (!ok) { await wait(900); return res.status(200).json({ ok: false, error: 'Username atau password salah' }); }
    return res.status(200).json({ ok: true, session: makeSession(adminUser, key), hours: SESSION_HOURS });
  }

  if (body.action === 'data') {
    const sess = readSession(body.session, key);
    if (!sess || sess.c) return res.status(401).json({ ok: false, error: 'sesi' });
    if (!readToken) return res.status(500).json({ ok: false, error: 'READ_TOKEN belum diisi di Vercel' });
    try {
      const [baru, mini, mindset, lama] = await Promise.all([readTab(url, readToken, ''), readTab(url, readToken, 'mini'), readTab(url, readToken, 'mindset'), readTab(url, readToken, 'lama').catch(() => []), readTab(url, readToken, 'klien').catch(() => [])]);
      return res.status(200).json({ ok: true, hasil: [...baru, ...lama.filter(r => r.sumber_data === 'web lama')], mini, mindset, at: new Date().toISOString() });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }
  // Kelola token: wajib masukkan password admin lagi. Hasilnya sesi khusus token, berlaku 15 menit.
  if (body.action === 'tokauth') {
    const sess = readSession(body.session, key);
    if (!sess || sess.c) return res.status(401).json({ ok: false, error: 'sesi' });
    if (!adminPass || !safeEq(String(body.pass || ''), adminPass)) { await wait(900); return res.status(200).json({ ok: false, error: 'Password salah' }); }
    const payload = Buffer.from(JSON.stringify({ u: sess.u, c: '', tk: 1, exp: Date.now() + 15 * 60e3 })).toString('base64url');
    return res.status(200).json({ ok: true, tksession: payload + '.' + sign(payload, key), minutes: 15 });
  }

  // Kelola token: khusus admin Mengapa, dengan sesi khusus token
  if (body.action === 'token') {
    const sess = readSession(body.session, key);
    if (!sess || sess.c) return res.status(401).json({ ok: false, error: 'sesi' });
    const tks = readSession(body.tksession, key);
    if (!tks || tks.c || !tks.tk) return res.status(403).json({ ok: false, error: 'tk' });
    const ops = { list: 'token_list', create: 'token_create', update: 'token_update', delete: 'token_delete', klien_create: 'klien_create', klien_update: 'klien_update', klien_delete: 'klien_delete', logo: 'klien_update' };
    const action = ops[body.op];
    if (!action) return res.status(400).json({ ok: false, error: 'op' });
    const pick = (o, keys) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k]) => keys.includes(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 300) : v]));
    const KK = ['klien', 'nama', 'username', 'password', 'catatan'];
    const payload = { secret: key, action };
    if (body.op === 'create') { Object.assign(payload, pick(body.data, ['jenis', 'kode', 'jumlah', 'awalan', 'kuota', 'berlaku', 'label', 'catatan', 'klien'])); if (body.data && body.data.klien_baru) payload.klien_baru = pick(body.data.klien_baru, KK); }
    if (body.op === 'update' || body.op === 'delete') {
      payload.tokens = (Array.isArray(body.tokens) ? body.tokens : []).map(t => String(t || '').trim()).filter(Boolean).slice(0, 1000);
      if (!payload.tokens.length) return res.status(400).json({ ok: false, error: 'Tidak ada token yang dipilih' });
    }
    if (body.op === 'update') { payload.op = ['aktif', 'nonaktif', 'set'].includes(body.mode) ? body.mode : ''; payload.fields = body.fields && typeof body.fields === 'object' ? body.fields : {}; if (!payload.op) return res.status(400).json({ ok: false, error: 'mode' }); }
    if (body.op === 'klien_create') payload.data = pick(body.data, KK);
    if (body.op === 'klien_update') { payload.klien = String(body.klien || ''); payload.fields = pick(body.fields, ['nama', 'username', 'password', 'catatan', 'status']); payload.nonaktifToken = !!body.nonaktifToken; }
    if (body.op === 'klien_delete') payload.klien = String(body.klien || '');
    let oldLogo = '';
    if (body.op === 'logo') {
      // upload logo ke Vercel Blob, lalu simpan URL-nya di tab Klien
      payload.klien = String(body.klien || ''); oldLogo = String(body.old || '');
      const tokenBlob = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
      if (!body.image) payload.fields = { logo: '' };
      else {
        if (!tokenBlob && !(process.env.BLOB_STORE_ID || '').trim() && !globalThis.__blobMock) return res.status(500).json({ ok: false, error: 'Vercel Blob belum terhubung ke project. Buka Vercel > Storage > Blob lalu hubungkan ke mengapa-tes.' });
        const m = String(body.image).match(/^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return res.status(400).json({ ok: false, error: 'Format gambar harus PNG, WebP, atau JPG' });
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 1.5e6) return res.status(400).json({ ok: false, error: 'Ukuran logo maksimal 1,5 MB' });
        const slug = payload.klien.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'klien';
        try {
          const up = await blobApi().put(`logo-klien/${slug}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, buf, { access: 'public', contentType: 'image/' + m[1], addRandomSuffix: true, token: tokenBlob || undefined });
          payload.fields = { logo: up.url };
        } catch (e) {
          const msg = String(e && e.message || e);
          return res.status(502).json({ ok: false, error: /oidc|credential|token/i.test(msg) ? 'Vercel Blob belum bisa diakses. Di Vercel > Storage > mengapa-logo, sambungkan ulang ke project dengan centang "Add a read-write token", lalu kabari tim.' : /private/i.test(msg) ? 'Blob store Vercel diatur Private. Buat ulang Blob dengan akses Public.' : 'Gagal upload logo: ' + msg });
        }
      }
    }
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Apps Script tidak membalas JSON'); }
      if (j.error === 'unauthorized') throw new Error('SHEET_SECRET di Vercel beda dengan di Apps Script');
      if (!j.tokens && (j.ok !== false || j.error === 'token')) throw new Error('Apps Script belum diperbarui. Tempel Code.gs terbaru lalu deploy ulang.');
      if (j.ok !== false && (j.klien || [])[0] && !('status' in j.klien[0]) && body.op.startsWith('klien')) throw new Error('Apps Script belum diperbarui. Tempel Code.gs terbaru lalu deploy ulang.');
      const stale = body.op === 'logo' && j.ok !== false ? oldLogo : body.op === 'klien_delete' && j.ok !== false ? j.old_logo : '';
      if (stale && isBlobUrl(stale)) { try { await blobApi().del(stale, { token: (process.env.BLOB_READ_WRITE_TOKEN || '').trim() || undefined }); } catch (e) { /* logo lama gagal dihapus: tidak apa-apa */ } }
      delete j.old_logo;
      return res.status(200).json({ ...j, at: new Date().toISOString() });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }

  // Tes Pandangan Kerja HK Gold: admin Mengapa, atau sesi klien HKGold
  if (body.action === 'pandangan') {
    const sess = readSession(body.session, key);
    const isAdmin = sess && !sess.c;
    const isHkGold = sess && sess.c === 'hkgold';
    if (!isAdmin && !isHkGold) return res.status(401).json({ ok: false, error: 'sesi' });
    if (!readToken) return res.status(500).json({ ok: false, error: 'READ_TOKEN belum diisi di Vercel' });
    try {
      const rows = await readTab(url, readToken, 'pandangan');
      return res.status(200).json({ ok: true, rows, at: new Date().toISOString() });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }
  return res.status(400).json({ ok: false, error: 'action' });
};
