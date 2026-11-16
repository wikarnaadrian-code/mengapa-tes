/**
 * MENGAPA · Tes 4 Temperamen → Google Sheet
 * Tab yang dibuat otomatis:
 *   "Token"  : daftar token tes lengkap (sekali pakai)
 *   "Hasil"  : hasil tes lengkap
 *   "Mini"   : hasil tes mini (gratis)
 *   "Mindset": hasil Growth Mindset Test (gratis)
 *   "PandanganKerja": hasil Tes Pandangan Kerja (khusus workshop HK Gold, tanpa notifikasi email)
 *
 * CARA PASANG (sekali saja):
 * 1. Buat Google Sheet baru, beri nama misalnya "Mengapa - Data Tes".
 * 2. Menu Extensions > Apps Script. Hapus isi default, paste SELURUH kode ini, klik Save.
 * 3. Ikon gear (Project Settings) > Script Properties > Add script property:
 *      SHEET_SECRET = kata sandi bebas yang panjang (sama persis dengan di Vercel)
 *      READ_TOKEN   = (opsional) kata sandi lain, untuk reader app tim nanti
 * 4. Pilih fungsi "setup" di toolbar, klik Run, izinkan akses (Allow).
 * 5. Deploy > New deployment > tipe "Web app": Execute as: Me, Who has access: Anyone.
 *    Copy "Web app URL" (berakhiran /exec). Ini APPS_SCRIPT_URL di Vercel.
 *
 * Kalau kode ini diubah: Deploy > Manage deployments > Edit (pensil) > Version: New version > Deploy.
 *
 * NOTIFIKASI EMAIL: setiap hasil tes baru dikirim ke NOTIF_EMAIL (lihat di bawah).
 *  Token tim internal tidak dikirimi email. Kuota Gmail biasa: 100 email per hari.
 *  Kalau gagal kirim (misalnya kuota habis), data tetap tersimpan di Sheet.
 *  Untuk mematikan notifikasi: ubah NOTIF_EMAIL jadi '' lalu deploy ulang.
 *
 * KELOLA TOKEN: paling mudah lewat dashboard admin (mengapa.me/admin > Kelola token).
 *  Tiga jenis token (kolom "jenis" di tab Token):
 *   personal = satu orang, satu kali tes. Status: aktif > dipakai (sedang dikerjakan) > selesai.
 *   klien    = satu kode untuk banyak orang (perusahaan/acara). Kuota opsional. Hasil masuk ke dashboard klien
 *              lewat kolom token di tab Klien. Tanpa email notifikasi.
 *   admin    = untuk tim Mengapa mencoba tes. Tanpa batas, tanpa email notifikasi.
 *  Kolom lain: kuota (kosong = tanpa batas), berlaku_sampai (YYYY-MM-DD, kosong = tanpa batas),
 *  label (nama batch, contoh "Workshop Nov"), dipakai_kali (jumlah tes yang sudah masuk).
 *  Status "nonaktif" = token dimatikan. Token lama berstatus "tim" otomatis dibaca sebagai token admin/klien.
 *  Menu "Mengapa" di Sheet tetap bisa dipakai untuk membuat token personal banyak sekaligus.
 *  Huruf besar/kecil harus sama persis saat peserta mengetik token (atau pakai link undangan ?token=KODE).
 */

const SHEET_HASIL = 'Hasil';
const SHEET_MINI = 'Mini';
const SHEET_MINDSET = 'Mindset';
const SHEET_PK = 'PandanganKerja';
const SHEET_TOKEN = 'Token';
const SHEET_KLIEN = 'Klien';
const SHEET_LAMA = 'Lama'; // hasil dari web app lama (impor sekali)
const KLIEN_HEADERS = ['klien', 'nama', 'username', 'password', 'token', 'catatan', 'status', 'logo', 'dibuat'];
// Alamat yang tidak boleh dipakai sebagai alamat dashboard klien (mengapa.me/<alamat>)
const KLIEN_RESERVED = ['admin', 'api', 'assets', 'klien', 'tim', 'layanan', 'index', 'pandangan-kerja', 'pandangan-kerja-hasil', 'logo-klien', 'apps-script',
  'robots', 'sitemap', 'favicon', 'public-workshops', 'private-workshops', 'tes', 'test', 'dashboard', 'login', 'mengapa', 'www', 'hasil', 'token'];
const TOKEN_HEADERS = ['token', 'status', 'catatan', 'dibuat', 'mulai_dipakai', 'selesai', 'id_hasil', 'sesi', 'jenis', 'kuota', 'berlaku_sampai', 'label', 'dipakai_kali'];
const TZ = 'Asia/Jakarta';
const NOTIF_EMAIL = 'mengapa.me@gmail.com';
const DASHBOARD_URL = 'https://www.mengapa.me/admin';
const TEXT_COLUMNS = ['id', 'token', 'whatsapp', 'tanggal_lahir', 'tanggal_tes', 'jam_tes', 'jawaban', 'kode_kombinasi'];

function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'json' }); }
  const secret = props.getProperty('SHEET_SECRET');
  if (!secret || !data || data.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (data.action === 'token') return json_(startToken_(data.token, data.session));
    if (data.action === 'token_list') return json_(tokenList_());
    if (data.action === 'token_create') return json_(tokenCreate_(data));
    if (data.action === 'token_update') return json_(tokenUpdate_(data));
    if (data.action === 'token_delete') return json_(tokenDelete_(data));
    if (data.action === 'klien_create') { const r = klienCreate_(data.data || {}); if (!r.ok) return json_(r); const o = tokenList_(); o.created_klien = r.klien; return json_(o); }
    if (data.action === 'klien_update') return json_(klienUpdate_(data));
    if (data.action === 'klien_delete') return json_(klienDelete_(data));

    const row = data.row || {};
    const pk = row.jenis_tes === 'pandangan';
    const mini = row.jenis_tes === 'mini' || row.jenis_tes === 'mindset' || pk;
    const sh = getSheet_(pk ? SHEET_PK : row.jenis_tes === 'mindset' ? SHEET_MINDSET : row.jenis_tes === 'mini' ? SHEET_MINI : SHEET_HASIL);
    let headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];

    // ID yang sama terkirim ulang: jangan simpan dua kali
    const idCol0 = headers.indexOf('id') + 1;
    if (idCol0 && sh.getLastRow() > 1 && row.id) {
      const found = sh.getRange(2, idCol0, sh.getLastRow() - 1, 1).createTextFinder(String(row.id)).matchEntireCell(true).findNext();
      if (found) return json_({ ok: true, duplicate: true });
    }

    // Tes lengkap wajib punya token yang sah untuk sesi ini
    let tokenTim = false;
    if (!mini) {
      const t = finishToken_(row.token, data.session, row.id);
      if (!t.ok) return json_({ ok: false, error: 'token', reason: t.reason });
      row.token = t.token || row.token; // simpan token persis seperti yang ditulis di tab Token
      tokenTim = !!t.tim;
    }

    const missing = Object.keys(row).filter(k => headers.indexOf(k) === -1);
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      headers = headers.concat(missing);
      formatTextColumns_(sh, headers);
    }
    sh.appendRow(headers.map(h => (row[h] === undefined || row[h] === null) ? '' : row[h]));
    if (!tokenTim && !pk) kirimNotif_(row); // email gagal tidak membatalkan penyimpanan data
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- NOTIFIKASI EMAIL ---------------- */
function kirimNotif_(row) {
  if (!NOTIF_EMAIL) return;
  try {
    const jenis = row.jenis_tes === 'mindset' ? 'Growth' : row.jenis_tes === 'mini' ? 'Mini' : 'Lengkap';
    const hasil = row.jenis_tes === 'mindset' ? (row.kategori || '') + (row.skor_total !== undefined ? ' (skor ' + row.skor_total + ')' : '')
      : row.jenis_tes === 'mini' ? (row.dominan_seri ? 'Seri: ' + row.dominan_seri : (row.dominan || ''))
      : (row.kombinasi || '') + ' (' + (row.dominan || '') + ' + ' + (row.sekunder || '') + ')';
    const nama = row.nama || 'Tanpa nama';
    const subjek = '[' + jenis + '] ' + nama + ' · ' + hasil;
    const wa = waLink_(row.whatsapp);
    const baris = [
      ['Jenis tes', jenis === 'Growth' ? 'Growth Mindset' : 'Tes Karakter ' + jenis],
      ['Nama', nama],
      ['Usia', row.usia],
      ['WhatsApp', row.whatsapp ? (wa ? '<a href="' + wa + '">' + esc_(row.whatsapp) + '</a>' : esc_(row.whatsapp)) : '-', true],
      ['Boleh dihubungi', row.boleh_dihubungi],
      ['Hasil', hasil],
      ['Tahu Mengapa dari', row.sumber],
      ['Token', row.token],
      ['Waktu', [row.tanggal_tes, row.jam_tes].filter(String).join(' ')],
      ['Durasi', row.durasi_detik ? Math.round(row.durasi_detik / 60 * 10) / 10 + ' menit' : ''],
      ['Kode hasil', row.id],
    ].filter(function (b) { return b[1] !== undefined && b[1] !== null && b[1] !== ''; });
    const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1D1D1D">'
      + '<p style="margin:0 0 12px">Ada hasil tes baru di mengapa.me.</p>'
      + '<table cellpadding="6" style="border-collapse:collapse">'
      + baris.map(function (b) { return '<tr><td style="color:#6E6E6E;padding-right:16px">' + b[0] + '</td><td><b>' + (b[2] ? b[1] : esc_(b[1])) + '</b></td></tr>'; }).join('')
      + '</table>'
      + '<p style="margin:16px 0 0"><a href="' + DASHBOARD_URL + '">Buka dashboard</a></p></div>';
    const teks = baris.map(function (b) { return b[0] + ': ' + (b[2] ? (row.whatsapp || '-') : b[1]); }).join('\n') + '\n\nDashboard: ' + DASHBOARD_URL;
    MailApp.sendEmail({ to: NOTIF_EMAIL, subject: subjek, body: teks, htmlBody: html, name: 'Mengapa · Notifikasi Tes' });
  } catch (err) {
    console.error('Notifikasi email gagal: ' + err);
  }
}
function waLink_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('0') === 0) d = '62' + d.slice(1);
  return 'https://wa.me/' + d;
}
function esc_(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// Jalankan sekali dari editor (pilih "tesNotifikasi" > Run) untuk cek email dan memberi izin kirim email
function tesNotifikasi() {
  kirimNotif_({ id: 'TES-123', jenis_tes: 'lengkap', nama: 'Contoh Peserta', usia: 28, whatsapp: '081234567890', boleh_dihubungi: 'YA',
    kombinasi: 'Thinker', dominan: 'Melankolis', sekunder: 'Plegmatis', sumber: 'Instagram', token: 'CONTOH', tanggal_tes: '2026-11-16', jam_tes: '15:00', durasi_detik: 540 });
}

/* ---------------- TOKEN ---------------- */
function normToken_(v) { return String(v || '').trim().replace(/\s+/g, ''); }
function tokenKey_(v) { return normToken_(v); } // case sensitive: huruf besar/kecil harus sama persis
const TC = {}; TOKEN_HEADERS.forEach(function (h, i) { TC[h] = i + 1; }); // nomor kolom per nama
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function ymd_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}
function iso_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v) ? v.toISOString() : String(v || ''); }
function num_(v) { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? 0 : n; }

// Token klien = token yang tercantum di kolom token tab Klien
function klienMap_() {
  const sh = getKlienSheet_(), out = { list: [], byToken: {} };
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, KLIEN_HEADERS.length).getValues().forEach(function (r, i) {
    const slug = String(r[0] || '').trim();
    if (!slug) return;
    const toks = String(r[4] || '').split(/[,;\n]/).map(function (t) { return t.trim(); }).filter(String);
    out.list.push({ klien: slug, nama: String(r[1] || slug), username: String(r[2] || ''), password: String(r[3] || ''), tokens: toks,
      catatan: String(r[5] || ''), status: String(r[6] || '').toLowerCase().trim() === 'nonaktif' ? 'nonaktif' : 'aktif', logo: String(r[7] || ''), dibuat: iso_(r[8]), row: i + 2 });
    toks.forEach(function (t) { out.byToken[t] = slug; });
  });
  return out;
}
function jenisOf_(status, jenis, token, km) {
  const j = String(jenis || '').toLowerCase().trim();
  if (j === 'personal' || j === 'klien' || j === 'admin') return j;
  if (String(status).toLowerCase().trim() === 'tim') return km && km.byToken[token] ? 'klien' : 'admin';
  return 'personal';
}
function rowObj_(r, rowNo, km) {
  const g = function (h) { return r[TC[h] - 1]; };
  const token = normToken_(g('token')), status = String(g('status') || '').toLowerCase().trim();
  return { row: rowNo, token: token, status: status, jenis: jenisOf_(status, g('jenis'), token, km), sesi: String(g('sesi') || ''), idHasil: String(g('id_hasil') || ''),
    kuota: num_(g('kuota')), berlaku: ymd_(g('berlaku_sampai')), dipakai: num_(g('dipakai_kali')) };
}
function readTokens_() {
  const sh = getTokenSheet_(), n = sh.getLastRow() - 1;
  return { sh: sh, vals: n > 0 ? sh.getRange(2, 1, n, TOKEN_HEADERS.length).getValues() : [] };
}
function findToken_(token) {
  const t = tokenKey_(token), d = readTokens_();
  if (!t) return { sh: d.sh, row: 0 };
  for (let i = 0; i < d.vals.length; i++) {
    if (tokenKey_(d.vals[i][0]) === t) {
      const o = rowObj_(d.vals[i], i + 2, String(d.vals[i][1]).toLowerCase().trim() === 'tim' && !d.vals[i][TC.jenis - 1] ? klienMap_() : null);
      o.sh = d.sh; return o;
    }
  }
  return { sh: d.sh, row: 0 };
}

// Dipanggil saat peserta memasukkan token
function startToken_(token, session) {
  const f = findToken_(token);
  if (!f.row) return { ok: false, reason: 'tidak_ditemukan' };
  if (f.status === 'nonaktif') return { ok: false, reason: 'nonaktif' };
  if (f.berlaku && today_() > f.berlaku) return { ok: false, reason: 'kedaluwarsa' };
  if (f.jenis !== 'personal') {
    if (f.kuota > 0 && f.dipakai >= f.kuota) return { ok: false, reason: 'kuota_habis' };
    return { ok: true }; // token klien/admin: bisa dipakai banyak orang
  }
  if (f.status === '' || f.status === 'aktif') {
    f.sh.getRange(f.row, TC.status).setValue('dipakai');
    f.sh.getRange(f.row, TC.mulai_dipakai).setValue(new Date());
    f.sh.getRange(f.row, TC.sesi).setValue(session);
    return { ok: true };
  }
  if (f.status === 'dipakai' && f.sesi === String(session)) return { ok: true }; // lanjut di perangkat yang sama
  return { ok: false, reason: 'sudah_dipakai' };
}

// Dipanggil saat hasil tes lengkap masuk
function finishToken_(token, session, idHasil) {
  const f = findToken_(token);
  if (!f.row) return { ok: false, reason: 'tidak_ditemukan' };
  if (f.jenis !== 'personal') {
    // hasil yang sudah dikerjakan selalu diterima, walau kuota/masa berlaku habis di tengah jalan
    if (f.status === 'tim') f.sh.getRange(f.row, TC.status).setValue('aktif');
    if (!f.sh.getRange(f.row, TC.jenis).getValue()) f.sh.getRange(f.row, TC.jenis).setValue(f.jenis);
    if (!f.sh.getRange(f.row, TC.mulai_dipakai).getValue()) f.sh.getRange(f.row, TC.mulai_dipakai).setValue(new Date());
    f.sh.getRange(f.row, TC.selesai).setValue(new Date());
    f.sh.getRange(f.row, TC.id_hasil).setValue(idHasil);
    f.sh.getRange(f.row, TC.dipakai_kali).setValue(f.dipakai + 1);
    return { ok: true, token: f.token, tim: true };
  }
  if (f.status === 'selesai' && f.idHasil === String(idHasil)) return { ok: true, token: f.token };
  if (f.status !== 'dipakai' || f.sesi !== String(session)) return { ok: false, reason: 'sudah_dipakai' };
  f.sh.getRange(f.row, TC.status).setValue('selesai');
  f.sh.getRange(f.row, TC.selesai).setValue(new Date());
  f.sh.getRange(f.row, TC.id_hasil).setValue(idHasil);
  f.sh.getRange(f.row, TC.dipakai_kali).setValue(1);
  return { ok: true, token: f.token };
}

/* ---------- kelola token dari dashboard admin ---------- */
function tokenList_() {
  const d = readTokens_(), km = klienMap_();
  // token lama: isi kolom jenis & ubah status "tim" jadi "aktif" (sekali saja)
  let changed = false, hitung = null;
  const pakaiDariHasil = function (t) {
    if (!hitung) {
      hitung = {};
      const sh = getSheet_(SHEET_HASIL), lc = sh.getLastColumn(), lr = sh.getLastRow();
      const c = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].indexOf('token') + 1 : 0;
      if (c && lr > 1) sh.getRange(2, c, lr - 1, 1).getValues().forEach(function (r) { const k = normToken_(r[0]); if (k) hitung[k] = (hitung[k] || 0) + 1; });
    }
    return hitung[t] || 0;
  };
  d.vals.forEach(function (r) {
    if (!normToken_(r[0])) return;
    const st = String(r[1] || '').toLowerCase().trim();
    if (!r[TC.jenis - 1]) { r[TC.jenis - 1] = jenisOf_(st, '', normToken_(r[0]), km); changed = true; }
    if (st === 'tim') { r[1] = 'aktif'; changed = true; }
    if (r[TC.jenis - 1] === 'personal' && !r[TC.kuota - 1]) { r[TC.kuota - 1] = 1; changed = true; }
    if (r[TC.jenis - 1] === 'personal' && st === 'selesai' && !r[TC.dipakai_kali - 1]) { r[TC.dipakai_kali - 1] = 1; changed = true; }
    if (r[TC.jenis - 1] !== 'personal' && r[TC.dipakai_kali - 1] === '') { r[TC.dipakai_kali - 1] = pakaiDariHasil(normToken_(r[0])); changed = true; }
  });
  if (changed && d.vals.length) d.sh.getRange(2, 1, d.vals.length, TOKEN_HEADERS.length).setValues(d.vals);
  const tokens = d.vals.filter(function (r) { return normToken_(r[0]); }).map(function (r) {
    const t = normToken_(r[0]);
    return { token: t, status: String(r[1] || '').toLowerCase().trim() || 'aktif', catatan: String(r[2] || ''), dibuat: iso_(r[3]), mulai: iso_(r[4]), selesai: iso_(r[5]),
      id_hasil: String(r[6] || ''), jenis: String(r[TC.jenis - 1]), kuota: num_(r[TC.kuota - 1]), berlaku: ymd_(r[TC.berlaku_sampai - 1]),
      label: String(r[TC.label - 1] || ''), dipakai: num_(r[TC.dipakai_kali - 1]), klien: km.byToken[t] || '' };
  });
  return { ok: true, tokens: tokens, klien: km.list.map(function (k) { return { klien: k.klien, nama: k.nama, username: k.username, password: k.password, catatan: k.catatan, status: k.status, logo: k.logo, dibuat: k.dibuat, tokens: k.tokens }; }), today: today_() };
}

function setKlienToken_(token, slug) {
  // lepas token dari semua klien, lalu (kalau ada slug) tambahkan ke klien itu
  const sh = getKlienSheet_();
  if (sh.getLastRow() < 2) return !slug;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, KLIEN_HEADERS.length).getValues();
  let found = !slug;
  vals.forEach(function (r, i) {
    const list = String(r[4] || '').split(/[,;\n]/).map(function (t) { return t.trim(); }).filter(String);
    const isTarget = slug && String(r[0]).trim().toLowerCase() === String(slug).toLowerCase();
    let next = list.filter(function (t) { return t !== token; });
    if (isTarget) { next.push(token); found = true; }
    if (next.join(', ') !== list.join(', ')) sh.getRange(i + 2, 5).setValue(next.join(', '));
  });
  return found;
}

function tokenCreate_(d) {
  if (d.klien_baru && d.jenis !== 'admin') {
    const kb = klienCreate_(d.klien_baru);
    if (!kb.ok) return kb;
    d.klien = kb.klien; d.created_klien = kb.klien;
  }
  const jenis = ['personal', 'klien', 'admin'].indexOf(d.jenis) >= 0 ? d.jenis : '';
  if (!jenis) return { ok: false, error: 'Jenis token tidak dikenal' };
  const slug = jenis === 'admin' ? '' : String(d.klien || '').trim();
  if (jenis === 'klien' && !slug) return { ok: false, error: 'Pilih klien untuk token klien' };
  const km = klienMap_();
  if (slug && !km.list.some(function (k) { return k.klien.toLowerCase() === slug.toLowerCase(); })) return { ok: false, error: 'Klien tidak ditemukan di tab Klien' };
  const berlaku = ymd_(d.berlaku), kuota = jenis === 'personal' ? 1 : jenis === 'klien' ? num_(d.kuota) : 0;
  const label = String(d.label || '').trim().slice(0, 60), catatan = String(d.catatan || '').trim().slice(0, 300);
  const rd = readTokens_(), existing = {};
  rd.vals.forEach(function (r) { existing[normToken_(r[0]).toLowerCase()] = true; });
  let codes = [];
  if (d.kode) {
    const k = normToken_(d.kode);
    if (!/^[A-Za-z0-9_.\-]{3,40}$/.test(k)) return { ok: false, error: 'Kode 3 sampai 40 karakter: huruf, angka, titik, strip, atau garis bawah' };
    if (existing[k.toLowerCase()]) return { ok: false, error: 'Kode ' + k + ' sudah dipakai token lain' };
    codes = [k];
  } else {
    const n = Math.max(1, Math.min(jenis === 'personal' ? 500 : 1, num_(d.jumlah) || 1));
    const pre = normToken_(d.awalan).replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 20) || (jenis === 'admin' ? 'ADMIN' : 'MGP');
    const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // tanpa 0/O/1/I supaya tidak tertukar
    let guard = 0;
    while (codes.length < n && guard++ < n * 50) {
      let c = ''; for (let i = 0; i < 6; i++) c += abc.charAt(Math.floor(Math.random() * abc.length));
      const t = pre + '-' + c;
      if (existing[t.toLowerCase()]) continue;
      existing[t.toLowerCase()] = true; codes.push(t);
    }
  }
  const now = new Date();
  const rows = codes.map(function (t) {
    const r = TOKEN_HEADERS.map(function () { return ''; });
    r[TC.token - 1] = t; r[TC.status - 1] = 'aktif'; r[TC.catatan - 1] = catatan; r[TC.dibuat - 1] = now;
    r[TC.jenis - 1] = jenis; r[TC.kuota - 1] = kuota || ''; r[TC.berlaku_sampai - 1] = berlaku; r[TC.label - 1] = label; r[TC.dipakai_kali - 1] = 0;
    return r;
  });
  rd.sh.getRange(rd.sh.getLastRow() + 1, 1, rows.length, TOKEN_HEADERS.length).setValues(rows);
  if (slug) {
    const sh = getKlienSheet_(), k = km.list.filter(function (x) { return x.klien.toLowerCase() === slug.toLowerCase(); })[0];
    const cur = String(sh.getRange(k.row, 5).getValue() || '').split(/[,;\n]/).map(function (t) { return t.trim(); }).filter(String);
    sh.getRange(k.row, 5).setValue(cur.concat(codes).join(', '));
  }
  const out = tokenList_(); out.created = codes; if (d.created_klien) out.created_klien = d.created_klien; return out;
}

function tokenUpdate_(d) {
  const want = {}; (d.tokens || []).forEach(function (t) { want[normToken_(t)] = true; });
  const rd = readTokens_(), km = klienMap_(), f = d.fields || {};
  let n = 0;
  rd.vals.forEach(function (r, i) {
    const t = normToken_(r[0]);
    if (!want[t]) return;
    const o = rowObj_(r, i + 2, km), row = i + 2, set = function (h, v) { rd.sh.getRange(row, TC[h]).setValue(v); };
    if (!r[TC.jenis - 1]) set('jenis', o.jenis);
    if (d.op === 'nonaktif') set('status', 'nonaktif');
    if (d.op === 'aktif') {
      if (o.jenis === 'personal') { set('status', 'aktif'); set('sesi', ''); set('mulai_dipakai', ''); }
      else set('status', 'aktif');
    }
    if (d.op === 'set') {
      if ('catatan' in f) set('catatan', String(f.catatan || '').slice(0, 300));
      if ('label' in f) set('label', String(f.label || '').trim().slice(0, 60));
      if ('berlaku' in f) set('berlaku_sampai', ymd_(f.berlaku));
      if ('kuota' in f && o.jenis === 'klien') set('kuota', num_(f.kuota) || '');
      if ('klien' in f && o.jenis !== 'admin' && !(o.jenis === 'klien' && !f.klien)) setKlienToken_(t, f.klien || '');
    }
    n++;
  });
  if (!n) return { ok: false, error: 'Token tidak ditemukan' };
  const out = tokenList_(); out.updated = n; return out;
}

/* ---------- kelola klien ---------- */
function slugOk_(slug) { return /^[A-Za-z0-9][A-Za-z0-9-]{1,38}[A-Za-z0-9]$/.test(slug); }
function klienCreate_(k) {
  const slug = String(k.klien || '').trim(), nama = String(k.nama || '').trim().slice(0, 80);
  if (!nama) return { ok: false, error: 'Isi nama klien' };
  if (!slugOk_(slug)) return { ok: false, error: 'Alamat 3 sampai 40 karakter: huruf, angka, atau strip (tidak di awal/akhir)' };
  if (KLIEN_RESERVED.indexOf(slug.toLowerCase()) >= 0) return { ok: false, error: 'Alamat ' + slug + ' tidak bisa dipakai' };
  const km = klienMap_();
  if (km.list.some(function (x) { return x.klien.toLowerCase() === slug.toLowerCase(); })) return { ok: false, error: 'Alamat ' + slug + ' sudah dipakai klien lain' };
  const user = String(k.username || '').trim().slice(0, 60) || ('admin_' + slug.toLowerCase());
  const pass = String(k.password || '').trim();
  if (pass.length < 6) return { ok: false, error: 'Password minimal 6 karakter' };
  const sh = getKlienSheet_();
  const r = KLIEN_HEADERS.map(function () { return ''; });
  r[0] = slug; r[1] = nama; r[2] = user; r[3] = pass; r[5] = String(k.catatan || '').slice(0, 300); r[6] = 'aktif'; r[8] = new Date();
  sh.getRange(sh.getLastRow() + 1, 1, 1, KLIEN_HEADERS.length).setValues([r]);
  return { ok: true, klien: slug };
}
function klienUpdate_(d) {
  const km = klienMap_(), k = km.list.filter(function (x) { return x.klien.toLowerCase() === String(d.klien || '').toLowerCase(); })[0];
  if (!k) return { ok: false, error: 'Klien tidak ditemukan' };
  const sh = getKlienSheet_(), f = d.fields || {}, col = function (h) { return KLIEN_HEADERS.indexOf(h) + 1; };
  if ('nama' in f) { const v = String(f.nama || '').trim().slice(0, 80); if (!v) return { ok: false, error: 'Nama klien tidak boleh kosong' }; sh.getRange(k.row, col('nama')).setValue(v); }
  if ('username' in f) { const v = String(f.username || '').trim().slice(0, 60); if (!v) return { ok: false, error: 'Username tidak boleh kosong' }; sh.getRange(k.row, col('username')).setValue(v); }
  if ('password' in f) { const v = String(f.password || '').trim(); if (v.length < 6) return { ok: false, error: 'Password minimal 6 karakter' }; sh.getRange(k.row, col('password')).setValue(v); }
  if ('catatan' in f) sh.getRange(k.row, col('catatan')).setValue(String(f.catatan || '').slice(0, 300));
  if ('logo' in f) sh.getRange(k.row, col('logo')).setValue(String(f.logo || '').slice(0, 500));
  if ('status' in f) {
    const st = f.status === 'nonaktif' ? 'nonaktif' : 'aktif';
    sh.getRange(k.row, col('status')).setValue(st);
    if (st === 'nonaktif' && d.nonaktifToken && k.tokens.length) {
      const rd = readTokens_(), want = {}; k.tokens.forEach(function (t) { want[t] = true; });
      rd.vals.forEach(function (r, i) { if (want[normToken_(r[0])]) rd.sh.getRange(i + 2, TC.status).setValue('nonaktif'); });
    }
  }
  return tokenList_();
}
function klienDelete_(d) {
  const km = klienMap_(), k = km.list.filter(function (x) { return x.klien.toLowerCase() === String(d.klien || '').toLowerCase(); })[0];
  if (!k) return { ok: false, error: 'Klien tidak ditemukan' };
  if (k.status !== 'nonaktif') return { ok: false, error: 'Nonaktifkan klien dulu sebelum dihapus' };
  getKlienSheet_().deleteRow(k.row);
  const out = tokenList_(); out.deleted_klien = k.klien; out.old_logo = k.logo; return out;
}

function tokenDelete_(d) {
  const want = {}; (d.tokens || []).forEach(function (t) { want[normToken_(t)] = true; });
  const rd = readTokens_(), rows = [];
  rd.vals.forEach(function (r, i) { if (want[normToken_(r[0])]) rows.push(i + 2); });
  rows.reverse().forEach(function (row) { rd.sh.deleteRow(row); });
  Object.keys(want).forEach(function (t) { setKlienToken_(t, ''); });
  const out = tokenList_(); out.deleted = rows.length; return out;
}

function getTokenSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_TOKEN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TOKEN, 0);
    sh.getRange(1, 1, 1, TOKEN_HEADERS.length).setValues([TOKEN_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.getRange(1, 7, sh.getMaxRows(), 2).setNumberFormat('@');
  }
  // kolom baru (jenis, kuota, berlaku_sampai, label, dipakai_kali) ditambahkan otomatis di kanan
  const head = sh.getRange(1, 1, 1, Math.max(1, Math.min(sh.getMaxColumns(), TOKEN_HEADERS.length))).getValues()[0];
  if (head.length < TOKEN_HEADERS.length || TOKEN_HEADERS.some(function (h, i) { return head[i] !== h; })) {
    if (sh.getMaxColumns() < TOKEN_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), TOKEN_HEADERS.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, TOKEN_HEADERS.length).setValues([TOKEN_HEADERS]).setFontWeight('bold');
    sh.getRange(1, TC.berlaku_sampai, sh.getMaxRows(), 2).setNumberFormat('@');
  }
  return sh;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mengapa')
    .addItem('Buat token personal', 'menuBuatToken')
    .addItem('Buat token admin (TIM-MENGAPA)', 'menuTokenTim')
    .addToUi();
}

function menuTokenTim() {
  const sh = getTokenSheet_(), f = findToken_('TIM-MENGAPA');
  if (f.row) { sh.getRange(f.row, TC.status).setValue('aktif'); sh.getRange(f.row, TC.jenis).setValue('admin'); }
  else sh.appendRow(['TIM-MENGAPA', 'aktif', 'token admin, tidak pernah habis', new Date(), '', '', '', '', 'admin', '', '', '', 0]);
  SpreadsheetApp.getUi().alert('Token admin siap: TIM-MENGAPA (bisa dipakai berkali-kali).');
}

function menuBuatToken() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Buat token', 'Berapa token? (1 sampai 500)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const n = Math.max(1, Math.min(500, parseInt(a.getResponseText(), 10) || 0));
  const b = ui.prompt('Awalan token', 'Contoh: MGP atau WORKSHOP-NOV. Kosongkan untuk MGP.', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  const c = ui.prompt('Catatan (opsional)', 'Contoh: batch workshop November', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  const made = buatToken_(n, b.getResponseText(), c.getResponseText());
  ui.alert(made.length + ' token dibuat di tab "Token".');
}

function buatToken_(n, prefix, catatan) {
  const sh = getTokenSheet_();
  const pre = normToken_(prefix) || 'MGP';
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // tanpa 0/O/1/I supaya tidak tertukar
  const existing = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[tokenKey_(r[0])] = true; });
  const rows = [];
  while (rows.length < n) {
    let code = '';
    for (let i = 0; i < 6; i++) code += abc.charAt(Math.floor(Math.random() * abc.length));
    const t = pre + '-' + code;
    if (existing[t]) continue;
    existing[t] = true;
    rows.push([t, 'aktif', catatan || '', new Date(), '', '', '', '', 'personal', 1, '', '', 0]);
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, TOKEN_HEADERS.length).setValues(rows);
  return rows.map(function (r) { return r[0]; });
}

/** Alternatif tanpa menu: jalankan dari editor Apps Script untuk membuat 10 token berawalan MGP. */
function buat10Token() { Logger.log(buatToken_(10, 'MGP', 'dibuat dari editor').join('\n')); }

/* ---------------- BACA DATA (untuk reader app tim nanti) ----------------
 *   GET .../exec?token=READ_TOKEN              -> semua hasil tes lengkap
 *   GET .../exec?token=READ_TOKEN&tab=mini     -> hasil tes mini
 *   GET .../exec?token=READ_TOKEN&tab=mindset  -> hasil Growth Mindset Test
 *   GET .../exec?token=READ_TOKEN&tab=lama     -> hasil tes dari web app lama
 *   GET .../exec?token=READ_TOKEN&tab=pandangan -> hasil Tes Pandangan Kerja (HK Gold)
 *   tambahkan &ref=febe atau &id=MGP-XXXXXX untuk filter
 */
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('READ_TOKEN');
  const p = (e && e.parameter) || {};
  if (!token || p.token !== token) return json_({ ok: true, service: 'mengapa-tes' });

  const sheet = p.tab === 'klien' ? getKlienSheet_() : getSheet_(p.tab === 'mini' ? SHEET_MINI : p.tab === 'mindset' ? SHEET_MINDSET : p.tab === 'lama' ? SHEET_LAMA : p.tab === 'pandangan' ? SHEET_PK : SHEET_HASIL);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift() || [];
  let rows = values.map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
  if (p.ref) rows = rows.filter(r => String(r.ref) === p.ref);
  if (p.id) rows = rows.filter(r => String(r.id) === p.id);
  return json_({ ok: true, count: rows.length, rows: rows });
}

/** Jalankan sekali dari editor untuk menyiapkan tab & izin. */
function setup() {
  getTokenSheet_(); getKlienSheet_(); getSheet_(SHEET_HASIL); getSheet_(SHEET_MINI); getSheet_(SHEET_MINDSET); getSheet_(SHEET_PK);
  Logger.log('Tab siap. Secret terpasang: ' +
    (PropertiesService.getScriptProperties().getProperty('SHEET_SECRET') ? 'YA' : 'BELUM, isi di Project Settings'));
}

// Tab "Klien": akun dashboard untuk perusahaan klien. Satu baris per klien.
//   klien    = alamat dashboard, contoh HKGold (mengapa.me/HKGold)
//   nama     = nama yang tampil, contoh HK Gold
//   username / password = untuk login klien
//   token    = token milik klien, boleh lebih dari satu dipisah koma. Klien hanya melihat hasil dari token ini.
//   status   = aktif / nonaktif (nonaktif = klien tidak bisa login) · logo = URL logo · dibuat = tanggal dibuat
//   Paling mudah dikelola lewat dashboard admin > Kelola Klien. Dashboard klien otomatis aktif di mengapa.me/<klien>.
function getKlienSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_KLIEN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_KLIEN);
    sh.getRange(1, 1, 1, KLIEN_HEADERS.length).setValues([KLIEN_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), KLIEN_HEADERS.length).setNumberFormat('@');
  }
  // kolom baru (status, logo, dibuat) ditambahkan otomatis di kanan
  const head = sh.getRange(1, 1, 1, Math.max(1, Math.min(sh.getMaxColumns(), KLIEN_HEADERS.length))).getValues()[0];
  if (head.length < KLIEN_HEADERS.length || KLIEN_HEADERS.some(function (h, i) { return head[i] !== h; })) {
    if (sh.getMaxColumns() < KLIEN_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), KLIEN_HEADERS.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, KLIEN_HEADERS.length).setValues([KLIEN_HEADERS]).setFontWeight('bold');
  }
  return sh;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.setFrozenRows(1); }
  return sh;
}

function formatTextColumns_(sh, headers) {
  TEXT_COLUMNS.forEach(name => {
    const c = headers.indexOf(name) + 1;
    if (c) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
