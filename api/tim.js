// Ruang Tim Mengapa: login + baca data dari Google Sheet (lewat Apps Script doGet).
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

function makeSession(user, key) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
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

  if (body.action === 'login') {
    if (!adminPass) return res.status(500).json({ ok: false, error: 'ADMIN_PASSWORD belum diisi di Vercel' });
    const ok = safeEq(String(body.user || '').trim().toLowerCase(), adminUser.toLowerCase()) && safeEq(String(body.pass || ''), adminPass);
    if (!ok) { await wait(900); return res.status(200).json({ ok: false, error: 'Username atau password salah' }); }
    return res.status(200).json({ ok: true, session: makeSession(adminUser, key), hours: SESSION_HOURS });
  }

  if (body.action === 'data') {
    if (!readSession(body.session, key)) return res.status(401).json({ ok: false, error: 'sesi' });
    if (!readToken) return res.status(500).json({ ok: false, error: 'READ_TOKEN belum diisi di Vercel' });
    try {
      const [hasil, mini, mindset] = await Promise.all([readTab(url, readToken, ''), readTab(url, readToken, 'mini'), readTab(url, readToken, 'mindset')]);
      return res.status(200).json({ ok: true, hasil, mini, mindset, at: new Date().toISOString() });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }
  return res.status(400).json({ ok: false, error: 'action' });
};
