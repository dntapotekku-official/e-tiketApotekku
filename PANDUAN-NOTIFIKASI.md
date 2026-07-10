# Panduan Aktivasi Push Notification — E-Tiket ApotekKU

Frontend sudah live otomatis lewat push repo. Sisanya 4 langkah di sisi Anda (±15 menit):

## 1. Prasyarat: HTTPS (WAJIB)
Service Worker & Push API hanya berjalan di HTTPS. Repo → Settings → Pages → centang **Enforce HTTPS**. Selama masih "Not Secure", tombol Aktifkan Notifikasi tidak akan bisa bekerja.

## 2. Upgrade Firebase ke paket Blaze
Cloud Functions butuh paket Blaze (pay-as-you-go): Firebase console → ikon gerigi → Usage and billing → Modify plan → Blaze. Volume tim internal hampir pasti Rp0/bulan (kuota gratis: 2 juta invokasi/bulan).

## 3. Generate VAPID key + tanam ke index.html
Firebase console → Project settings → **Cloud Messaging** → bagian **Web Push certificates** → **Generate key pair** → salin key-nya (string panjang diawali huruf/angka acak).
Lalu edit `index.html`: cari `VAPID_PUBLIC_KEY` (persis di bawah firebaseConfig) → ganti `"GANTI_DENGAN_VAPID_PUBLIC_KEY"` dengan key tadi → commit/upload. (Atau kirim key-nya ke asisten AI Anda untuk ditanamkan.)
> VAPID *public* key memang aman dipublikasikan — bukan server key.

## 4. Deploy Cloud Function (dari laptop, sekali saja)
```bash
git pull                       # tarik folder functions/ dkk dari repo
npm install -g firebase-tools  # bila belum
firebase login
cd e-tiketApotekku             # folder repo lokal
cd functions && npm install && cd ..
firebase deploy --only functions
```
Sukses ditandai: `functions[notifyNewTicket(asia-southeast1)] Successful create operation.`

## Cara pakai (tim DNT)
1. Buka https://eticket.apotekku.com → login (cahya/agus/gede/egar) → Dashboard.
2. Panel "🔔 Push notification tiket baru" → klik **Aktifkan Notifikasi** → Allow.
3. Status berubah "Notifikasi aktif di perangkat ini". Ulangi di tiap komputer/browser tim.

## Testing end-to-end
1. Komputer A: login admin, aktifkan notifikasi, lalu **minimize browser**.
2. Komputer B/HP: login akun divisi → buat tiket baru.
3. Komputer A: notifikasi sistem muncul ("Tiket Baru: ..." + prioritas • sistem • divisi). Klik → tab aplikasi terbuka/terfokus langsung ke kartu tiketnya (tersorot merah berdenyut).
4. Ulangi dengan halaman terbuka (foreground): muncul toast di kanan-bawah + bunyi bel "cling".
5. Cek log kiriman di RTDB: node `/notification_logs`.

## Aturan penerima
Tiket baru → push ke **PIC sistemnya + semua superadmin**. Tiket tanpa PIC → semua admin. Token rusak/kedaluwarsa otomatis ditandai `active:false` dan tidak dikirimi lagi.

## Catatan platform
- Chrome/Edge/Firefox desktop & Android: penuh.
- iPhone/iPad: buka situs di Safari → Share → **Add to Home Screen** → buka dari ikon → baru aktifkan notifikasi (ketentuan Apple, iOS 16.4+).
- Bel foreground: browser mensyaratkan interaksi dulu di halaman (sekali klik apa pun) sebelum audio boleh berbunyi — normal.
- Opsional: taruh file `assets/bell.mp3` di repo untuk mengganti bel sintesis dengan suara sendiri (otomatis terdeteksi).
