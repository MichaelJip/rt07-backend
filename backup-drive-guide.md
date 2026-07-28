# Backup Otomatis ke Google Drive — RT07 Backend

Pelengkap dari `MAINTENANCE.md` (panduan operasional VPS umum). Dokumen ini khusus soal backup MongoDB harian (lokal) + backup bulanan terenkripsi ke Google Drive (offsite), termasuk cara setup ulang dari nol dan cara restore.

Dibuat: 28 Juli 2026 — setelah setup & verifikasi pertama berhasil.

---

## 📌 Info Penting

| Item | Nilai |
|---|---|
| Database | `db-rt-07-unggul` |
| Folder backup lokal (VPS) | `/home/Michael/backups` |
| Retensi lokal | 30 hari (auto-hapus) |
| Remote rclone | `gdrive` (scope: `drive.file` — hanya akses file yang dibuat rclone sendiri, bukan seluruh Drive) |
| Folder di Google Drive | `gdrive:RT07-Backups/` |
| Script upload | `/home/Michael/upload-to-drive.sh` (chmod 700) |
| File password enkripsi | `/home/Michael/.backup_pass` (chmod 600) |
| Jadwal backup harian | 02:00 tiap hari |
| Jadwal cleanup lokal | 02:30 tiap hari |
| Jadwal upload ke Drive | 03:00, tanggal 1 tiap bulan |

> ⚠️ **Password enkripsi di `.backup_pass` WAJIB dicatat juga di password manager terpisah.** Kalau file ini hilang atau lupa, semua `.tar.gz.enc` di Google Drive **tidak bisa dibuka lagi** — tidak ada jalan recovery.

---

## 🗄️ 1. Arsitektur Backup

Dua lapis:

1. **Harian, lokal di VPS** — `mongodump` mentah ke folder bertanggal, retensi 30 hari. Cepat dipakai untuk restore kasus ringan (misal salah hapus data).
2. **Bulanan, offsite ke Google Drive** — ambil backup lokal terbaru → compress (`tar.gz`) → encrypt (`openssl aes-256-cbc`) → upload ke Drive. Jaring pengaman kalau VPS sendiri bermasalah (hilang, kena serangan, disk rusak).

Alasan dienkripsi sebelum upload: data resident (NIK/KK) belum ter-enkripsi di database aslinya, jadi kalau backup mentah naik ke cloud pihak ketiga, itu jadi celah kebocoran data pribadi warga.

---

## ⚙️ 2. Setup Cron

```bash
crontab -e
```

Isi (pilih nano kalau ditanya editor):

```
0 2 * * * mongodump --db db-rt-07-unggul --out /home/Michael/backups/$(date +\%Y\%m\%d) >> /home/Michael/backup.log 2>&1
30 2 * * * find /home/Michael/backups -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \;
0 3 1 * * /bin/bash /home/Michael/upload-to-drive.sh >> /home/Michael/backup-drive.log 2>&1
```

Verifikasi: `crontab -l`

---

## ☁️ 3. Setup rclone (Google Drive) — kalau perlu setup ulang / pindah VPS baru

1. Install:
```bash
curl https://rclone.org/install.sh | sudo bash
```

2. Config:
```bash
rclone config
```
- `n` → new remote
- Nama: `gdrive`
- Storage type: pilih **Google Drive**
- Client ID / Client Secret: kosongin, Enter
- Scope: pilih **`3`** (`drive.file` — access to files created by rclone only)
- root_folder_id, service_account_file: kosongin, Enter
- Edit advanced config? → `n`
- Use auto config? → **`n`** (VPS tidak ada browser)

3. rclone menampilkan command `rclone authorize "drive" "..."`. Jalankan command itu di **laptop** yang ada browser (download rclone dari rclone.org/downloads dulu kalau belum ada, extract, jalankan `.\rclone.exe authorize ...` dari folder hasil extract). Login Google, izinkan akses, copy seluruh token JSON yang muncul di terminal laptop.

4. Balik ke VPS, paste token di prompt `config_token>`.

5. "Configure as Shared Drive (Team Drive)?" → `n` (kecuali memang pakai Team Drive)

6. Konfirmasi `y` (keep remote), keluar dengan `q`.

7. Test:
```bash
rclone lsd gdrive:
rclone mkdir gdrive:RT07-Backups
```

> ⚠️ **Catatan penting:** rclone memberi warning bahwa shared client_id bawaan mereka akan di-retire selama 2026. Kalau suatu saat upload berhenti jalan tanpa error yang jelas, ini kemungkinan penyebabnya — perlu bikin client_id sendiri lewat Google Cloud Console (gratis). Detail: https://rclone.org/drive/#making-your-own-client-id

---

## 📜 4. Script Upload (`upload-to-drive.sh`)

Buat file password (sekali saja, atau ulang kalau setup di VPS baru):
```bash
echo "PASSWORD_PILIHAN_KAMU" > /home/Michael/.backup_pass
chmod 600 /home/Michael/.backup_pass
```

Buat script:
```bash
nano /home/Michael/upload-to-drive.sh
```

Isi:
```bash
#!/bin/bash
LATEST=$(ls -1 /home/Michael/backups | sort -r | head -n 1)
BACKUP_PATH="/home/Michael/backups/$LATEST"
ARCHIVE="/home/Michael/backups/rt07-$LATEST.tar.gz"
ENCRYPTED="$ARCHIVE.enc"

tar -czf "$ARCHIVE" -C /home/Michael/backups "$LATEST"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$ARCHIVE" -out "$ENCRYPTED" -pass file:/home/Michael/.backup_pass
rm "$ARCHIVE"

rclone copy "$ENCRYPTED" gdrive:RT07-Backups/
rm "$ENCRYPTED"
```

Simpan, lalu:
```bash
chmod 700 /home/Michael/upload-to-drive.sh
```

Test manual sebelum diserahkan ke cron:
```bash
bash /home/Michael/upload-to-drive.sh
rclone ls gdrive:RT07-Backups/
```
Harus muncul baris dengan ukuran file + nama `rt07-TANGGAL.tar.gz.enc`.

---

## ♻️ 5. Restore

### A. Restore dari backup lokal VPS (kasus umum — data rusak/salah hapus)

```bash
mongorestore --db db-rt-07-unggul --drop /home/Michael/backups/TANGGAL/db-rt-07-unggul
pm2 restart rt-backend
```

### B. Restore dari Google Drive (kasus VPS hilang/rusak total → mulai dari VPS baru)

1. Setup ulang rclone di VPS baru (Bagian 3), lalu download file `.enc`:
```bash
mkdir -p /home/Michael/restore
rclone copy gdrive:RT07-Backups/rt07-TANGGAL.tar.gz.enc /home/Michael/restore/
```

2. Siapkan file password (dari catatan di password manager kamu):
```bash
echo "PASSWORD_YANG_DICATAT" > /home/Michael/.backup_pass
chmod 600 /home/Michael/.backup_pass
```

3. Decrypt:
```bash
cd /home/Michael/restore
openssl enc -d -aes-256-cbc -pbkdf2 -in rt07-TANGGAL.tar.gz.enc -out rt07-TANGGAL.tar.gz -pass file:/home/Michael/.backup_pass
```

4. Extract:
```bash
tar -xzf rt07-TANGGAL.tar.gz
```

5. Restore ke MongoDB:
```bash
mongorestore --db db-rt-07-unggul --drop /home/Michael/restore/TANGGAL/db-rt-07-unggul
```

6. Restart aplikasi:
```bash
pm2 restart rt-backend
```

---

## ✅ 6. Checklist Verifikasi Berkala

Sesekali (misal tiap awal bulan setelah tanggal 1), cek:

```bash
cat /home/Michael/backup.log        # backup harian jalan tanpa error?
cat /home/Michael/backup-drive.log  # upload bulanan jalan tanpa error?
rclone ls gdrive:RT07-Backups/      # file terbaru sudah ada?
```

---

## 🆘 Troubleshooting

| Gejala | Penyebab paling mungkin | Solusi |
|---|---|---|
| `upload-to-drive.sh` gagal, folder backups kosong | Cron harian belum sempat jalan / `mongodump` gagal | Cek `backup.log`, jalankan `mongodump` manual dulu |
| Upload tiba-tiba berhenti tanpa error jelas (nanti di 2026) | Shared client_id rclone di-retire | Bikin client_id sendiri, lihat Bagian 3 |
| Tidak bisa decrypt file `.enc` | Password salah / file `.backup_pass` beda dari saat backup dibuat | Cek ulang catatan password di password manager |
| `rclone lsd gdrive:` error auth | Token expired / remote belum ke-setup di VPS baru | Ulangi Bagian 3 dari awal |

---

*Referensi lengkap operasional VPS (reboot, deploy, update sistem, backup harian dasar) ada di `MAINTENANCE.md`.*
