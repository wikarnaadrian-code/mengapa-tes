/**
 * MENGAPA · Tes 4 Temperamen → Google Sheet
 * Tab yang dibuat otomatis:
 *   "Token"  : daftar token tes lengkap (sekali pakai)
 *   "Hasil"  : hasil tes lengkap
 *   "Mini"   : hasil tes mini (gratis)
 *   "Mindset": hasil Growth Mindset Test (gratis)
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
 * CARA BIKIN TOKEN:
 *  a) Manual / custom: ketik token di kolom A tab "Token", bebas (contoh Magelang_OCIE atau budi-2026). Tanpa spasi.
 *     Huruf besar/kecil dianggap sama saat peserta mengetik.
 *     Kolom status boleh dikosongkan. Kolom catatan bebas (nama pembeli, tanggal bayar, dll).
 *  b) Banyak sekaligus: buka Sheet di laptop, menu "Mengapa" > "Buat token baru".
 *  Status "tim" = token internal untuk testing, tidak pernah habis (hasilnya tetap tersimpan di tab Hasil dengan token itu).
 *  Status: (kosong)/aktif = belum dipakai · dipakai = tes sedang dikerjakan · selesai = sudah dipakai · nonaktif = dibatalkan.
 *  Peserta ganti HP di tengah tes? Ubah status token itu kembali jadi "aktif".
 */

const SHEET_HASIL = 'Hasil';
const SHEET_MINI = 'Mini';
const SHEET_MINDSET = 'Mindset';
const SHEET_TOKEN = 'Token';
const SHEET_KLIEN = 'Klien';
const KLIEN_HEADERS = ['klien', 'nama', 'username', 'password', 'token', 'catatan'];
const TOKEN_HEADERS = ['token', 'status', 'catatan', 'dibuat', 'mulai_dipakai', 'selesai', 'id_hasil', 'sesi'];
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

    const row = data.row || {};
    const mini = row.jenis_tes === 'mini' || row.jenis_tes === 'mindset';
    const sh = getSheet_(row.jenis_tes === 'mindset' ? SHEET_MINDSET : row.jenis_tes === 'mini' ? SHEET_MINI : SHEET_HASIL);
    let headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];

    // ID yang sama terkirim ulang: jangan simpan dua kali
    const idCol0 = headers.indexOf('id') + 1;
    if (idCol0 && sh.getLastRow() > 1 && row.id) {
      const found = sh.getRange(2, idCol0, sh.getLastRow() - 1, 1).createTextFinder(String(row.id)).matchEntireCell(true).findNext();
      if (found) return json_({ ok: true, duplicate: true });
    }

    // Tes lengkap wajib punya token yang sah untuk sesi ini
    if (!mini) {
      const t = finishToken_(row.token, data.session, row.id);
      if (!t.ok) return json_({ ok: false, error: 'token', reason: t.reason });
      row.token = t.token || row.token; // simpan token persis seperti yang ditulis di tab Token
    }

    const missing = Object.keys(row).filter(k => headers.indexOf(k) === -1);
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      headers = headers.concat(missing);
      formatTextColumns_(sh, headers);
    }
    sh.appendRow(headers.map(h => (row[h] === undefined || row[h] === null) ? '' : row[h]));
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- TOKEN ---------------- */
function normToken_(v) { return String(v || '').trim().replace(/\s+/g, ''); }
function tokenKey_(v) { return normToken_(v).toLowerCase(); } // huruf besar/kecil dianggap sama

function findToken_(token) {
  const sh = getTokenSheet_();
  const t = tokenKey_(token);
  if (!t || sh.getLastRow() < 2) return { sh: sh, row: 0 };
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, TOKEN_HEADERS.length).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (tokenKey_(vals[i][0]) === t) return { sh: sh, row: i + 2, token: normToken_(vals[i][0]), status: String(vals[i][1]).toLowerCase().trim(), sesi: String(vals[i][7]), idHasil: String(vals[i][6]) };
  }
  return { sh: sh, row: 0 };
}

// Dipanggil saat peserta memasukkan token
function startToken_(token, session) {
  const f = findToken_(token);
  if (!f.row) return { ok: false, reason: 'tidak_ditemukan' };
  if (f.status === 'tim') return { ok: true }; // token tim internal: bisa dipakai berkali-kali
  if (f.status === '' || f.status === 'aktif') {
    f.sh.getRange(f.row, 2).setValue('dipakai');
    f.sh.getRange(f.row, 5).setValue(new Date());
    f.sh.getRange(f.row, 8).setValue(session);
    return { ok: true };
  }
  if (f.status === 'dipakai' && f.sesi === String(session)) return { ok: true }; // lanjut di perangkat yang sama
  if (f.status === 'nonaktif') return { ok: false, reason: 'nonaktif' };
  return { ok: false, reason: 'sudah_dipakai' };
}

// Dipanggil saat hasil tes lengkap masuk
function finishToken_(token, session, idHasil) {
  const f = findToken_(token);
  if (!f.row) return { ok: false, reason: 'tidak_ditemukan' };
  if (f.status === 'tim') { f.sh.getRange(f.row, 6).setValue(new Date()); f.sh.getRange(f.row, 7).setValue(idHasil); return { ok: true, token: f.token }; }
  if (f.status === 'selesai' && f.idHasil === String(idHasil)) return { ok: true, token: f.token };
  if (f.status !== 'dipakai' || f.sesi !== String(session)) return { ok: false, reason: 'sudah_dipakai' };
  f.sh.getRange(f.row, 2).setValue('selesai');
  f.sh.getRange(f.row, 6).setValue(new Date());
  f.sh.getRange(f.row, 7).setValue(idHasil);
  return { ok: true, token: f.token };
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
  return sh;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mengapa')
    .addItem('Buat token baru', 'menuBuatToken')
    .addItem('Buat token tim (abadi)', 'menuTokenTim')
    .addToUi();
}

function menuTokenTim() {
  const sh = getTokenSheet_(), f = findToken_('TIM-MENGAPA');
  if (f.row) sh.getRange(f.row, 2).setValue('tim');
  else sh.appendRow(['TIM-MENGAPA', 'tim', 'token tim internal, tidak pernah habis', new Date(), '', '', '', '']);
  SpreadsheetApp.getUi().alert('Token tim siap: TIM-MENGAPA (status "tim", bisa dipakai berkali-kali).');
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
    if (existing[t.toLowerCase()]) continue;
    existing[t.toLowerCase()] = true;
    rows.push([t, 'aktif', catatan || '', new Date(), '', '', '', '']);
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
 *   tambahkan &ref=febe atau &id=MGP-XXXXXX untuk filter
 */
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('READ_TOKEN');
  const p = (e && e.parameter) || {};
  if (!token || p.token !== token) return json_({ ok: true, service: 'mengapa-tes' });

  const sheet = p.tab === 'klien' ? getKlienSheet_() : getSheet_(p.tab === 'mini' ? SHEET_MINI : p.tab === 'mindset' ? SHEET_MINDSET : SHEET_HASIL);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift() || [];
  let rows = values.map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i]; }); return o; });
  if (p.ref) rows = rows.filter(r => String(r.ref) === p.ref);
  if (p.id) rows = rows.filter(r => String(r.id) === p.id);
  return json_({ ok: true, count: rows.length, rows: rows });
}

/** Jalankan sekali dari editor untuk menyiapkan tab & izin. */
function setup() {
  getTokenSheet_(); getKlienSheet_(); getSheet_(SHEET_HASIL); getSheet_(SHEET_MINI); getSheet_(SHEET_MINDSET);
  Logger.log('Tab siap. Secret terpasang: ' +
    (PropertiesService.getScriptProperties().getProperty('SHEET_SECRET') ? 'YA' : 'BELUM, isi di Project Settings'));
}

// Tab "Klien": akun dashboard untuk perusahaan klien. Satu baris per klien.
//   klien    = alamat dashboard, contoh HKGold (mengapa.me/HKGold)
//   nama     = nama yang tampil, contoh HK Gold
//   username / password = untuk login klien
//   token    = token milik klien, boleh lebih dari satu dipisah koma. Klien hanya melihat hasil dari token ini.
function getKlienSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_KLIEN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_KLIEN);
    sh.getRange(1, 1, 1, KLIEN_HEADERS.length).setValues([KLIEN_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), KLIEN_HEADERS.length).setNumberFormat('@');
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
