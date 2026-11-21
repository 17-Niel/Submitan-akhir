# Jejak — Cerita Perjalanan

Aplikasi SPA berbasis Vite untuk Dicoding Story API. Mendukung peta, cerita publik, koleksi offline, draft yang tersinkron otomatis, push notification, serta instalasi PWA.

## Menjalankan lokal

```bash
npm install
npm run dev
```

Build untuk produksi:

```bash
npm run build
npm run preview
```

## Deploy ke Vercel

Import repository di Vercel dengan framework preset **Vite**. Build command `npm run build`, output directory `dist`. `vercel.json` mengarahkan seluruh rute SPA ke `index.html`.

API menggunakan `https://story-api.dicoding.dev/v1` secara default. Jika perlu mengganti endpoint, set `VITE_API_BASE_URL` pada Vercel Project Settings sebelum build. Jangan masukkan token pengguna ke environment variable; token disimpan di browser setelah login.
ss
## Fitur

- Jelajahi cerita Story API, cari cerita, lihat marker dan lokasi pada OpenStreetMap.
- Daftar/masuk, buat cerita, dan pilih lokasi dari peta, pencarian tempat, atau geolokasi.
- Simpan/hapus cerita di IndexedDB dan baca kembali ketika offline.
- Buat draft cerita saat offline; sinkronisasi berjalan otomatis ketika koneksi kembali.
- Aktifkan/nonaktifkan push notification setelah masuk. Notifikasi dinamis menampilkan payload dari service worker dan tombol aksinya membuka cerita.
- Installable PWA, manifest dengan ikon, screenshot, shortcut, dan app shell offline.

Untuk mengaktifkan push, browser harus mendukung Push API dan pengguna harus memberi izin notifikasi. Peta/tile dan pencarian tempat memerlukan internet; cerita yang sudah tersimpan tetap dapat dibaca offline.
