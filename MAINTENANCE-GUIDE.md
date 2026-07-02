# Maintenance Guide — RT Backend

Panduan operasional harian VPS: backup, restore, reboot, update sistem, dan deploy.
Dibuat berdasarkan setup asli server (2 Juli 2026).

---

## 📌 Info Penting Server (JANGAN LUPA)

| Item | Nilai |
|---|---|
| IP VPS | `IP_VPS` |
| User SSH | `Michael` |
| Folder aplikasi | `/var/www/rt07-backend` |
| Nama proses PM2 | `rt-backend` |
| **Nama database asli** | **`db-rt-07-unggul`** |
| Folder backup di VPS | `~/backups` (= `/home/Michael/backups`) |
| Folder backup di PC | `D:\backup` |

> ⚠️ **PENTING:** File `.env` di VPS tertulis `DATABASE_URL=mongodb://localhost:27017/rt-database`,
> tapi itu **BUKAN** database yang dipakai! Nama database di-hardcode di kode
> (`src/utils/database.ts` → `dbName: "db-rt-07-unggul"`).
> Semua perintah backup/restore harus pakai `db-rt-07-unggul`.

---

## 💾 1. Backup Database (di VPS)

SSH ke VPS dulu:

```bash
ssh Michael@IP_VPS
```

Lalu jalankan:

```bash
mongodump --db db-rt-07-unggul --out ~/backups/$(date +%Y%m%d)
```

Output yang benar: banyak baris `writing db-rt-07-unggul.users ...` dan `done dumping ... (XX documents)`.

Verifikasi hasilnya:

```bash
ls -la ~/backups/$(date +%Y%m%d)/db-rt-07-unggul
```

Harus ada file `.bson`: `users.bson`, `iurans.bson`, `inventories.bson`, `pengeluarans.bson`, `settings.bson`.

> ❌ Kalau `mongodump` diam saja tanpa output = nama database salah, tidak ada yang di-backup!

---

## 💻 2. Download Backup ke PC

Jalankan dari **PowerShell di laptop** (BUKAN di dalam SSH VPS — prompt harus `PS C:\...>` atau `PS D:\...>`):

```powershell
cd D:\backup
scp -r Michael@IP_VPS:~/backups/20260702 .
```

Ganti `20260702` dengan tanggal backup yang mau diambil (format `YYYYMMDD`).

Verifikasi:

```powershell
dir .\20260702\db-rt-07-unggul
```

> ⚠️ Jangan tulis tujuan sebagai `D:\backup\...` langsung di perintah scp —
> tanda `:` pada `D:` bikin scp mengira itu nama server. Selalu `cd` dulu ke folder tujuan, lalu pakai `.`

---

## ♻️ 3. Restore Database (kalau data rusak/hilang beneran)

> Restore = menimpa isi database dengan isi backup. Lakukan hanya kalau yakin.

### Restore dari backup di VPS:

```bash
mongorestore --db db-rt-07-unggul --drop ~/backups/TANGGAL/db-rt-07-unggul
```

Contoh: `mongorestore --db db-rt-07-unggul --drop ~/backups/20260702/db-rt-07-unggul`

`--drop` = hapus collection lama dulu, lalu isi dengan data backup (hasil = persis seperti saat backup).

### Restore dari backup di PC (kalau backup di VPS sudah tidak ada):

Upload dulu dari PowerShell laptop:

```powershell
cd D:\backup
scp -r .\20260702 Michael@IP_VPS:~/backups/
```

Lalu SSH ke VPS dan jalankan perintah `mongorestore` di atas.

### Setelah restore, restart aplikasi:

```bash
pm2 restart rt-backend
```

---

## 🔄 4. Setelah Reboot VPS — Checklist Wajib

Kejadian 2 Juli 2026: setelah reboot, data "hilang" — ternyata MongoDB tidak hidup otomatis.
Sudah diperbaiki dengan `systemctl enable mongod`, tapi kalau terulang, cek urut:

```bash
# 1. Cek MongoDB
sudo systemctl status mongod        # harus "active (running)", tekan q untuk keluar

# Kalau mati:
sudo systemctl start mongod
sudo systemctl enable mongod        # supaya otomatis hidup tiap reboot

# 2. Cek data masih ada
mongosh --quiet --eval "db.adminCommand('listDatabases').databases.forEach(d => print(d.name))"
# db-rt-07-unggul harus muncul

# 3. Cek aplikasi
pm2 status                          # rt-backend harus "online"
# Kalau kosong: pm2 resurrect
# Kalau online tapi error koneksi: pm2 restart rt-backend

# 4. Cek log
pm2 logs rt-backend --lines 15      # cari "Database connected!"
```

> 💡 Data "hilang" setelah reboot hampir selalu = MongoDB belum hidup. Data di disk TIDAK terhapus oleh reboot.
>
> 💡 MongoDB Compass kelihatan kosong setelah reboot = SSH tunnel Compass putus. Disconnect lalu Connect ulang.

---

## 🐧 5. Update Sistem Ubuntu

**Selalu backup dulu (Bagian 1) sebelum update sistem!**

```bash
sudo apt update && sudo apt upgrade -y
```

- Prompt ungu "Which services should be restarted?" → biarkan default, Tab ke `<Ok>`, Enter
- Prompt soal config file → pilih "keep the local version currently installed"

Cek perlu reboot atau tidak:

```bash
cat /var/run/reboot-required
```

- Ada tulisan "System restart required" → `sudo reboot`, tunggu ±1 menit, SSH lagi, jalankan **checklist Bagian 4**
- "No such file or directory" → tidak perlu reboot, selesai

---

## 🚀 6. Deploy Update Kode

### Di laptop (push kode ke GitHub):

```powershell
cd d:\React\rt-backend
git checkout main
git merge NAMA_BRANCH        # kalau kerja di branch lain
git push origin main
```

### Di VPS:

```bash
cd /var/www/rt07-backend
./deploy.sh
```

`deploy.sh` otomatis: `git pull origin main` → `npm install` → `npm run build` → `pm2 restart`.

### Verifikasi:

```bash
pm2 logs rt-backend --lines 20
```

Harus muncul:
- `Database connected!`
- `Monthly iuran generation scheduled: 1st of every month at 00:01 AM` (kode baru per Juli 2026)

> ✅ Deploy TIDAK menghapus data. Database dan folder `uploads/` tidak disentuh oleh deploy.
> ❌ Jangan pernah re-clone repo dari nol untuk update — `.env` dan `uploads/` bisa hilang.

---

## 🧹 7. Cleanup Iuran Unpaid Masa Depan (sekali saja, sudah/akan dilakukan Juli 2026)

Setelah deploy sistem iuran bulanan yang baru, hapus iuran unpaid yang terlanjur dibuat
untuk bulan-bulan ke depan (misal 2026-08 s/d 2026-12). Dari Postman:

```
DELETE https://DOMAIN_API/api/iuran/cleanup-future
Authorization: Bearer <token admin>
```

- Hanya menghapus iuran `regular` berstatus **unpaid** dengan period **setelah bulan sekarang**
- Iuran paid dan advance payment TIDAK tersentuh
- Response berisi `deletedCount` = jumlah yang dihapus
- Setelah ini, cron tanggal 1 tiap bulan otomatis membuat iuran bulan berjalan

---

## 📅 Backup Otomatis Harian (opsional, disarankan)

Di VPS:

```bash
crontab -e
```

Tambahkan baris ini (backup tiap hari jam 2 pagi, otomatis hapus backup lebih tua dari 30 hari):

```
0 2 * * * mongodump --db db-rt-07-unggul --out /home/Michael/backups/$(date +\%Y\%m\%d)
30 2 * * * find /home/Michael/backups -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \;
```

Lalu tinggal sesekali download ke PC dengan cara di Bagian 2.

---

## 🆘 Troubleshooting Cepat

| Gejala | Penyebab paling mungkin | Solusi |
|---|---|---|
| Data "hilang" setelah reboot | MongoDB belum hidup | `sudo systemctl start mongod` → `pm2 restart rt-backend` |
| `mongodump` diam tanpa output | Nama database salah | Pakai `db-rt-07-unggul` |
| `scp` error "Could not resolve hostname d" | Path Windows `D:\` mengandung `:` | `cd` ke folder tujuan dulu, pakai `.` |
| Compass kosong | SSH tunnel putus | Disconnect + Connect ulang di Compass |
| App online tapi error DB | App start sebelum MongoDB siap | `pm2 restart rt-backend` |
| PM2 kosong setelah reboot | Proses belum di-resurrect | `pm2 resurrect` |
| App tidak jalan sama sekali | Cek log | `pm2 logs rt-backend` |

---

*Dibuat: 2 Juli 2026 — setelah backup pertama + update sistem + perbaikan mongod autostart.*
