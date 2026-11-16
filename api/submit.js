// Vercel Serverless Function untuk Mengapa · Tes 4 Temperamen
// 1) Cek token tes lengkap   2) Simpan hasil tes (mini & lengkap) ke Google Sheet lewat Apps Script
// Env var wajib di Vercel > Project > Settings > Environment Variables:
//   APPS_SCRIPT_URL  = URL Web App dari Apps Script (berakhiran /exec)
//   SHEET_SECRET     = kata sandi bebas, harus SAMA dengan SHEET_SECRET di Apps Script

const MAX_BYTES = 20000;

async function callSheet(url, payload) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { console.error('Apps Script error', r.status, text.slice(0, 300)); return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (!('cek' in (req.query || {}))) return res.status(200).json({ ok: true, service: 'mengapa-tes' });
    // Diagnosa koneksi: buka /api/submit?cek di browser. Tidak menampilkan isi rahasia.
    const u = process.env.APPS_SCRIPT_URL || '', sec = process.env.SHEET_SECRET || '';
    const out = { url_terisi: !!u, url_berakhiran_exec: /\/exec\/?$/.test(u.trim()), url_ada_spasi: u !== u.trim(), secret_terisi: !!sec, secret_ada_spasi: sec !== sec.trim() };
    if (u && sec) {
      try {
        const r = await fetch(u.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: sec.trim(), action: 'token', token: 'CEK-DIAGNOSA', session: 'diag' }), redirect: 'follow' });
        const t = await r.text();
        out.status_apps_script = r.status;
        try { const j = JSON.parse(t); out.jawaban_apps_script = j;
          out.kesimpulan = j.error === 'unauthorized' ? 'SHEET_SECRET di Vercel beda dengan di Apps Script (atau belum diisi di Script Properties)' : j.reason === 'tidak_ditemukan' ? 'KONEKSI OK' : 'cek jawaban_apps_script';
        } catch (e) { out.cuplikan = t.slice(0, 200).replace(/\s+/g, ' '); out.kesimpulan = /accounts\.google|Sign in|signin/i.test(t) ? 'Apps Script minta login: Deploy ulang dengan Who has access = Anyone' : 'Apps Script tidak membalas JSON: cek URL /exec dan deployment'; }
      } catch (e) { out.kesimpulan = 'gagal menghubungi Apps Script: ' + String(e.message || e); }
    } else out.kesimpulan = 'Env var belum terbaca: isi di Vercel lalu Redeploy';
    return res.status(200).json(out);
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  const url = (process.env.APPS_SCRIPT_URL || '').trim();
  const secret = (process.env.SHEET_SECRET || '').trim();
  if (!url || !secret) return res.status(500).json({ ok: false, error: 'server belum dikonfigurasi', reason: 'server' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch (e) { return res.status(400).json({ ok: false, error: 'json' }); }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'payload' });
  if (JSON.stringify(body).length > MAX_BYTES) return res.status(413).json({ ok: false, error: 'terlalu besar' });

  const normToken = v => String(v || '').trim().replace(/\s+/g, '').replace(/[\u0000-\u001f]/g, '').slice(0, 60);
  const session = String(body.session || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

  try {
    // ---------- cek token ----------
    if (body.action === 'token') {
      const token = normToken(body.token);
      if (token.length < 3 || !session) return res.status(200).json({ ok: false, reason: 'tidak_ditemukan' });
      const j = await callSheet(url, { secret, action: 'token', token, session });
      if (!j || typeof j.ok !== 'boolean') return res.status(200).json({ ok: false, reason: 'server' });
      return res.status(200).json({ ok: j.ok, reason: j.reason || '' });
    }

    // ---------- simpan hasil ----------
    if (!body.row) return res.status(400).json({ ok: false, error: 'payload' });
    if (body.hp) return res.status(200).json({ ok: true }); // bot: pura-pura sukses, data dibuang

    const row = body.row;
    const mini = row.jenis_tes === 'mini';
    const mindset = row.jenis_tes === 'mindset';
    const pk = row.jenis_tes === 'pandangan'; // Tes Pandangan Kerja (khusus HK Gold)
    for (const k of (pk ? ['id', 'nama', 'jabatan', 'jawaban'] : ['id', 'nama', 'tanggal_lahir', 'jawaban'])) if (!row[k]) return res.status(400).json({ ok: false, error: 'kurang: ' + k });
    if (!(pk ? /^[1-5]{24}[1-4]{3}$/ : mindset ? /^[1-5]{15}$/ : mini ? /^[SCMP]{10}$/ : /^[SCMP]{40}$/).test(String(row.jawaban))) return res.status(400).json({ ok: false, error: 'jawaban' });
    if (!mini && !mindset && !pk && !normToken(row.token)) return res.status(200).json({ ok: false, error: 'token' });

    // Bersihkan: hanya teks/angka pendek, cegah formula spreadsheet (=, +, -, @)
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
      let s = v == null ? '' : typeof v === 'number' ? v : String(v).slice(0, 1200);
      if (typeof s === 'string' && /^[=+\-@]/.test(s) && !/^\+?\d[\d\s-]*$/.test(s)) s = "'" + s;
      clean[k] = s;
    }
    clean.jenis_tes = pk ? 'pandangan' : mindset ? 'mindset' : mini ? 'mini' : 'lengkap';
    if (!mini && !mindset && !pk) clean.token = normToken(row.token);
    clean.diterima_server = new Date().toISOString();
    clean.ip_negara = req.headers['x-vercel-ip-country'] || '';
    clean.ip_kota = decodeURIComponent(req.headers['x-vercel-ip-city'] || '');

    const j = await callSheet(url, { secret, row: clean, session });
    if (!j) return res.status(502).json({ ok: false, error: 'sheet' });
    if (j.ok !== true) return res.status(j.error === 'token' ? 200 : 502).json({ ok: false, error: j.error || 'sheet' });
    return res.status(200).json({ ok: true, duplicate: !!j.duplicate });
  } catch (e) {
    console.error('fetch gagal', e);
    return res.status(502).json({ ok: false, error: 'network', reason: 'network' });
  }
};
