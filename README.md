# Mengapa · Tes 4 Temperamen

Web app tes kepribadian 4 temperamen (kerangka Florence Littauer) untuk Mengapa.
Situs statis + 1 fungsi server di Vercel, data masuk ke Google Sheet.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Halaman utama |
| `assets/content.js` | **Semua teks, 40 baris soal, 12 kombinasi, insight lapangan, dan angka ambang batas (CONFIG).** File yang paling sering diubah. |
| `assets/scoring.js` | Hitung skor, dominan/sekunder, penanda pendalaman |
| `assets/app.js` | Tampilan & alur (landing, cara isi, data diri, persetujuan, tes, hasil) |
| `assets/art.js` | Ilustrasi SVG & kartu share IG Story |
| `assets/styles.css` | Desain |
| `api/submit.js` | Fungsi Vercel yang meneruskan hasil ke Google Sheet |
| `apps-script/Code.gs` | Kode untuk Google Sheet (tidak ikut di-deploy ke Vercel) |
| `og.png`, `favicon.svg` | Gambar preview link & ikon tab |

Tambahkan `logo.png` (logo Mengapa dari situs lama) di folder utama. Kalau tidak ada, header otomatis pakai tulisan MENGAPA.

## Langkah deploy (sekali saja, ±20 menit, pakai laptop)

### 1. Google Sheet
1. Buat Google Sheet baru, misalnya "Mengapa - Data Tes".
2. Extensions > Apps Script. Hapus isi default, paste isi `apps-script/Code.gs`, Save.
3. Ikon gear (Project Settings) > Script Properties > tambah:
   - `SHEET_SECRET` = kata sandi panjang bebas, misalnya `mgp-7f3k9q2x-2026`
   - `READ_TOKEN` = (opsional) kata sandi lain untuk reader app tim nanti
4. Pilih fungsi `setup` di toolbar > Run > izinkan akses.
5. Deploy > New deployment > tipe **Web app** > Execute as: **Me** > Who has access: **Anyone** > Deploy.
6. Copy **Web app URL** (berakhiran `/exec`).

### 2. GitHub
1. Buat repo baru (boleh private), misalnya `mengapa-tes`.
2. Di halaman repo: "uploading an existing file" > drag **isi** folder ini (bukan foldernya) dari Finder > Commit.
   Pastikan folder `assets`, `api`, `apps-script` ikut terupload.

### 3. Vercel
1. Add New > Project > Import repo `mengapa-tes`. Framework Preset: **Other**. Jangan isi build command.
2. Sebelum Deploy, buka Environment Variables, isi:
   - `APPS_SCRIPT_URL` = URL `/exec` dari langkah 1
   - `SHEET_SECRET` = sama persis dengan di Apps Script
3. Deploy. Buka link-nya, isi tes sampai selesai, cek baris baru muncul di tab **Hasil** di Google Sheet.

### 4. Domain
Rekomendasi: pakai subdomain dulu, misalnya **tes.mengapa.me**, supaya situs mengapa.me yang lama tetap jalan di Firebase.
Vercel > Project > Settings > Domains > tambah `tes.mengapa.me` > ikuti instruksi DNS (biasanya CNAME ke `cname.vercel-dns.com`).
Kalau nanti seluruh situs pindah ke Vercel, tinggal ganti domainnya.

## Hal yang sering diubah (semua di `assets/content.js`)
- Nomor WhatsApp: `CONFIG.whatsapp`
- Ambang insight lapangan (sekarang > 7): `CONFIG.fieldThreshold`
- Ambang skor ekstrem (sekarang > 20): `CONFIG.extremeScore`
- Selisih kelemahan vs kekuatan (sekarang 5): `CONFIG.weaknessGap`
- Usia minimum & usia wajib izin wali: `CONFIG.minAge`, `CONFIG.adultAge`
- Kata-kata soal: `STRENGTHS` dan `WEAKNESSES` (urutan per baris harus tetap 1 kata per temperamen)
- Nama, deskripsi, tokoh, fun fact tiap kombinasi: `COMBOS`

Setelah mengubah file di GitHub (bisa langsung edit di github.com dari HP), Vercel otomatis deploy ulang.

## Link per anggota tim
Tambahkan `?ref=nama` di belakang link, misalnya `https://tes.mengapa.me/?ref=febe`.
Kolom `ref` di Sheet akan terisi, jadi nanti bisa difilter per orang.

## Kolom penting di Google Sheet
- `id`: kode hasil (MGP-XXXXXX), sama dengan yang tampil di layar user dan pesan WhatsApp
- `tanggal_tes`, `jam_tes`: kapan tes diambil
- `*_kekuatan`, `*_kelemahan`, `*_total`: jumlah pilihan per temperamen (contoh `sanguinis_kekuatan`)
- `*_kata_kekuatan`, `*_kata_kelemahan`: kata-kata yang dipilih di kolom temperamen itu
- `pendalaman`: **Tinggi** (skor > 20 atau kelemahan jauh melebihi kekuatan) / **Sedang** (kombinasi berlawanan, tiga temperamen berdekatan, atau ketidakseimbangan umum) / kosong
- `alasan_pendalaman`: penjelasan untuk tim. User tidak pernah melihat kata "trauma".
- `terlalu_cepat`: YA kalau 40 soal selesai < 90 detik (hasil kurang bisa dipercaya)
- `jawaban`: 40 huruf S/C/M/P sesuai urutan baris

## Reader app tim (nanti)
`GET <APPS_SCRIPT_URL>?token=READ_TOKEN` mengembalikan semua data dalam JSON.
Tambah `&ref=febe` atau `&id=MGP-XXXXXX` untuk filter.
