# RT Backend — API Reference

Base URL (local): `http://localhost:3000/api`
Semua path di bawah relatif terhadap base URL itu (contoh: `/auth/login` = `http://localhost:3000/api/auth/login`).

Auth: `Authorization: Bearer <token>` (didapat dari `POST /auth/login`).
Response envelope standar: `{ meta: { status, message }, data }` (list endpoint juga punya `pagination`).

## Enum referensi

- **ROLES**: `admin`, `rt`, `rw`, `bendahara`, `sekretaris`, `satpam`, `warga`
- **USER_STATUS**: `active`, `inactive`, `away`, `moved`
- **IURAN_STATUS**: `unpaid`, `pending`, `paid`, `rejected`
- **Iuran type**: `regular`, `custom`
- **Event status**: `planning`, `active`, `completed`
- **Event expense category**: `HIBURAN`, `LOMBA`, `KONSUMSI`, `LAINNYA`

---

## Auth

### POST /auth/register
Daftar user baru. `multipart/form-data` (file field: `image_url`, optional).
- Body: `email` (opsional, wajib jika role=admin), `username` (wajib, min 5), `password` (opsional, wajib jika role=admin, default `"password123"`), `role` (wajib, enum ROLES), `address` (opsional), `phone_number` (opsional, digit saja 10-15), `position` (opsional), `created_at` (opsional, `YYYY-MM` atau `YYYY-MM-DD`, tidak boleh masa depan)
- Auto-generate iuran unpaid (50000/bulan) dari `created_at` s/d bulan berjalan (hanya jika role bukan admin & status active).
- Response: dokumen user lengkap.
- Auth: tidak perlu.

### POST /auth/login
- Body (JSON): `identifier` (username atau email), `password`
- Menolak login jika status `moved` atau user sudah dihapus (soft-delete).
- Response: `data` = JWT token (string).
- Auth: tidak perlu.

### GET /auth/me
- Tidak ada body/query/params (pakai token).
- Response: profil user saat ini (tanpa password).
- Auth: wajib (semua role).

### POST /auth/push-token
- Body (JSON): `pushToken` (wajib)
- Response: user (tanpa password).
- Auth: wajib.

### PATCH /auth/profile
`multipart/form-data` (file field: `image_url`, optional).
- Body: `username`, `address`, `position`, `phone_number` (semua opsional, phone digit 10-15)
- File lama otomatis dihapus dari disk jika diganti.
- Response: user (tanpa password).
- Auth: wajib.

### GET /user
- Query: `limit` (default 10), `page` (default 1), `search` (cocok username/email/address), `status` (`active|inactive|away|moved`), `includeDeleted` (`"true"|"false"`), `full` (`"true"|"false"` — perlu token role privileged: admin/bendahara/sekretaris/rt/rw untuk return semua field)
- Default (tanpa `full`): hanya `_id, username, address, phone_number, status, role, image_url, unpaidIuranCount, unpaidIuranPeriods`
- Dengan `full=true` + token privileged: semua field user (minus password) + `unpaidIuranCount, unpaidIuranPeriods`
- Response: paginated array.
- Auth: publik (opsional untuk `full=true`).

### GET /user/template/download
- Tidak ada params. Return file `.xlsx` (stream, bukan JSON).
- Auth: tidak perlu.

### POST /user/import
`multipart/form-data` (file field: `file`).
- Sheet Excel harus bernama "Data Pengguna", kolom: email, username, role, address, phone_number
- Response: `{ success: string[], skipped: string[], errors: [{row, email, errors}] }`
- Auth: admin only.

### GET /user/export
- Query: `ids` (opsional, string atau array user ID — filter; kalau kosong export semua)
- Return file `.xlsx` (stream).
- Auth: admin only.

### DELETE /user/:id
- Params: `id`
- Soft delete (`isDeleted=true`), hapus iuran UNPAID user (iuran PAID tetap disimpan).
- Response: `{ deletedUnpaidIuran: number }`
- Auth: admin only.

### PATCH /user/:id
`multipart/form-data` (file field: `image_url`, optional).
- Params: `id`
- Body: `username`, `email`, `address`, `phone_number`, `role` (semua opsional)
- Response: user (tanpa password).
- Auth: admin only.

### PATCH /user/:id/status
- Params: `id`
- Body (JSON): `status` (wajib, `active|inactive|away|moved`), `statusNote` (opsional)
- Side effect: pindah dari active → moved/inactive hapus iuran unpaid; pindah ke active dari status lain generate iuran bulan berjalan jika belum ada.
- Response: user (tanpa password).
- Auth: admin only.

### POST /user/:id/restore
- Params: `id`. Tidak ada body.
- Restore user soft-deleted (`isDeleted=false`, `status=active`), pastikan iuran bulan berjalan ada.
- Response: `{ user, iuranCreated: number }`
- Auth: admin only.

---

## Iuran

### GET /iuran
- Query: `limit` (default 10), `page` (default 1), `search` (cocok periode via regex jika `period` kosong), `status` (bisa comma-separated untuk multi status), `period` (exact match `YYYY-MM`), `userId` (ObjectId)
- Response: array iuran (populate `user.username`, `confirmed_by.username`), paginated.
- Auth: wajib (semua role login).

### GET /iuran/receipt
- Query: `ids` (wajib, comma-separated iuran ID)
- Hanya iuran status `paid`; semua ID harus milik user yang sama.
- Response: `{ receiptPdfUrl, receipt: { receiptNumber, receiptDate, paymentDate, user: {id, username, email}, periods[], amountPerPeriod, totalPeriods, totalAmount, paymentMethod, note, recordedBy: {id, username} } }`
- Auth: wajib.

### GET /iuran/template/download
- Tidak ada params. Return `.xlsx` stream.
- Auth: tidak perlu.

### GET /iuran/export
- **Tidak ada params.** Export semua iuran ber-status `paid` saja, semua user non-admin, sebagai grid Excel (baris = user, kolom = bulan; kolom bulan otomatis mengikuti rentang periode paling awal–akhir dari data yang ada).
- Return `.xlsx` stream.
- Auth: admin, bendahara, sekretaris.

### GET /iuran/status-summary/:period
- Params: `period` (contoh `2026-08`)
- Response: `{ paid, pending, rejected, unpaid }` (jumlah masing-masing status).
- Auth: tidak perlu.

### POST /iuran/record-payment
- Body (JSON): `userId` (wajib), `amount` (wajib, harus persis `50000 × periods.length`), `periods` (wajib, array string `YYYY-MM`, maksimal tahun berjalan+2), `payment_date` (opsional, default sekarang), `payment_method` (opsional), `note` (opsional)
- Update iuran unpaid existing jadi paid, atau create baru per periode.
- Response: `{ success, updated, created, failed, updatedIuran, createdIuran, errors }`
- Auth: admin, bendahara, sekretaris.

### POST /iuran/revert-payment
- Body (JSON): `{ ids: string[] }` (iuran document `_id`)
- Hanya proses iuran `paid`; tipe `custom` dihapus, tipe `regular` di-reset ke `unpaid`. ID yang bukan `paid` di-skip (masuk `errors`, tidak fatal).
- Response: `{ success, reverted, deleted, failed, revertedIuran, deletedIds, errors }`
- Auth: admin, bendahara, sekretaris.

### POST /iuran/create-yearly
- Body (JSON): `year` (wajib, number, 2020-2100)
- Buat iuran unpaid `regular` untuk semua user non-admin, 12 bulan penuh tahun tsb (skip yang sudah ada).
- Response: `{ year, totalUsers, totalCreated, totalSkipped, userResults: [{userId, username, created, skipped}] }`
- Auth: admin only.

### DELETE /iuran/cleanup-future
- Tidak ada body/query/params.
- Hapus semua iuran `regular` UNPAID dengan periode > bulan berjalan (paid/advance/custom aman).
- Response: `{ currentPeriod, deletedCount }`
- Auth: admin only.

### POST /iuran/import
`multipart/form-data` (file field: `file`).
- Query: `clear` (opsional, `"true"` — hapus semua iuran hasil import sebelumnya dulu)
- Excel di-parse via kolom: no, nama, alamat, start, lalu sel bulanan. User dicocokkan/dibuat by nama+alamat, iuran digenerate dari `start` s/d bulan berjalan, status paid/unpaid mengikuti isi sel, ditandai `is_imported: true`.
- Response: `{ totalRows, usersCreated, usersFound, iuranCreated, errors: string[], processedUsers: string[] }`
- Auth: admin, bendahara, sekretaris.

---

## Keuangan (Laporan & Pengeluaran)

### GET /keuangan/laporan
- Tidak ada params.
- Response: `{ initial_balance, total_income, total_iuran_income, total_event_donations, total_dana_masuk, total_expense, balance, events: [{name, slug, date, total_donations, total_expenses, balance, completed_at}] }`
- Auth: publik.

### POST /pengeluaran
`multipart/form-data` (any files, pola field `items[N][image]`).
- Body: `title` (wajib), `total` (wajib, number, harus ≤ saldo saat ini), `items` (wajib array — bisa `items[]` JSON atau bracket-notation `items[0][name]`, `items[0][price]`), tiap item bisa punya file `items[N][image]` (opsional)
- Slug auto-generate unik dari title.
- Response: dokumen pengeluaran lengkap.
- Auth: admin, bendahara, sekretaris.

### GET /pengeluaran
- Query: `limit` (default 10), `page` (default 1), `search` (cocok title)
- Response: paginated array (populate `created_by.username`).
- Auth: publik.

### GET /pengeluaran/slug/:slug
- Params: `slug`
- Response: satu dokumen pengeluaran.
- Auth: publik.

### GET /pengeluaran/:id
- Params: `id`
- Response: satu dokumen pengeluaran.
- Auth: publik.

### PATCH /pengeluaran/:id
`multipart/form-data` (any files).
- Params: `id`
- Body: `title` (opsional), `total` (opsional — delta dicek vs saldo jika naik), `items` (opsional, sama bentuk create; file baru per item ganti + hapus file lama)
- Response: dokumen pengeluaran lengkap.
- Auth: admin, bendahara, sekretaris.

### DELETE /pengeluaran/:id
- Params: `id`
- Hapus dokumen + semua file gambar item dari disk.
- Response: dokumen pengeluaran yang dihapus.
- Auth: admin, bendahara, sekretaris.

> Catatan: `getCurrentBalance()` = `initial_balance + paid_iuran(non-imported) + event_donations(completed) + dana_masuk − total_pengeluaran`.

---

## Inventory

### GET /inventory
- Query: `limit` (default 10), `page` (default 1), `search` (cocok name)
- Response: paginated array (populate `createdBy.username email`).
- Auth: publik.

### GET /inventory/:id
- Params: `id`
- Response: satu dokumen (populate `createdBy`).
- Auth: publik.

### POST /inventory
`multipart/form-data` (file field: `image_url`, optional).
- Body: `name` (wajib, min 1), `quantity` (wajib, dikirim sebagai string)
- Response: dokumen inventory lengkap.
- Auth: admin, bendahara, rt.

### PATCH /inventory/:id
`multipart/form-data` (file field: `image_url`, optional).
- Params: `id`
- Body: `name` (opsional), `quantity` (opsional, string) — minimal satu field harus ada
- File lama diganti + dihapus dari disk.
- Response: dokumen inventory lengkap.
- Auth: admin, bendahara, rt.

### DELETE /inventory/:id
- Params: `id`
- Hapus dokumen + file gambar dari disk.
- Response: dokumen yang dihapus.
- Auth: admin, bendahara, rt.

---

## Event

### POST /event
- Body (JSON): `name` (wajib), `description` (wajib), `date` (wajib, date string)
- Slug auto-generate unik; status default `planning`.
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### GET /event
- Query: `limit` (default 10), `page` (default 1), `status` (opsional: `planning|active|completed`)
- Response: paginated array (populate `created_by.username`).
- Auth: admin, bendahara, sekretaris.

### GET /event/:id
- Params: `id`
- Response: dokumen event lengkap (populate `created_by.username`).
- Auth: admin, bendahara, sekretaris.

### GET /event/slug/:slug
- Params: `slug`
- Hanya event `status: completed`; field `created_by` dan `expenses.proof_image_urls` disembunyikan.
- Response: dokumen event (partial).
- Auth: publik.

### PATCH /event/:id
- Params: `id`
- Body (JSON): `name`, `description`, `date`, `status` (semua opsional)
- Diblokir jika event sudah `completed`, kecuali role admin.
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### DELETE /event/:id
- Params: `id`
- Diblokir jika completed kecuali admin; jika completed, cascade hapus pengeluaran terkait.
- Response: `null`.
- Auth: admin, bendahara, sekretaris.

### POST /event/:id/donation
- Params: `id`
- Body (JSON): `donor_name` (wajib), `amount` (wajib, number/string), `date` (opsional, default sekarang), `address` (opsional)
- Diblokir jika completed kecuali admin. Auto-ubah status `planning` → `active`.
- Response: dokumen event lengkap (donations[] terupdate).
- Auth: admin, bendahara, sekretaris.

### PATCH /event/:id/donation/:donationId
- Params: `id`, `donationId`
- Body (JSON): `donor_name`, `amount`, `date`, `address` (semua opsional)
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### DELETE /event/:id/donation/:donationId
- Params: `id`, `donationId`
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### POST /event/:id/expense
`multipart/form-data` (any files → jadi `proof_image_urls[]`).
- Params: `id`
- Body: `description` (wajib), `amount` (wajib), `category` (wajib: `HIBURAN|LOMBA|KONSUMSI|LAINNYA`), `date` (opsional, default sekarang)
- Diblokir jika completed kecuali admin. Auto-ubah status `planning` → `active`.
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### PATCH /event/:id/expense/:expenseId
- Params: `id`, `expenseId`
- Body (JSON): `description`, `amount`, `date`, `category` (semua opsional)
- Jika event completed dan `amount` berubah, dicek vs saldo saat ini + sync ke item pengeluaran terkait.
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### DELETE /event/:id/expense/:expenseId
- Params: `id`, `expenseId`
- Jika event completed, juga update/hapus item pengeluaran terkait (hapus dokumen pengeluaran seluruhnya jika jadi kosong).
- Response: dokumen event lengkap.
- Auth: admin, bendahara, sekretaris.

### POST /event/:id/complete
- Params: `id`. Tidak ada body.
- Buat satu dokumen pengeluaran per expense (linked via `event_id`), set status event `completed` + `completed_at`.
- Response: `{ event, balance, total_donations, total_expenses, pengeluaran_created, summary }`
- Auth: admin, bendahara, sekretaris.

### GET /event/:id/download-report
- Params: `id`
- Hanya berfungsi jika event `status: completed`. Return `.xlsx` stream.
- Auth: admin, bendahara, sekretaris.

---

## Dana Masuk (Suntik Dana)

### GET /dana-masuk
- Query: `limit` (default 10), `page` (default 1)
- Field yang dikembalikan hanya: `nama_pemberi, nominal, keterangan, createdAt`.
- Response: paginated array.
- Auth: publik.

### POST /dana-masuk
- Body (JSON): `nama_pemberi` (wajib), `nominal` (wajib, number > 0), `keterangan` (opsional)
- Response: dokumen dana masuk lengkap.
- Auth: admin, bendahara.

### DELETE /dana-masuk/:id
- Params: `id`
- Response: dokumen yang dihapus.
- Auth: admin only.

---

## Settings

### GET /settings
- Tidak ada params.
- Response: object key-value, contoh `{ initial_balance: number }` (default 0 jika belum diset).
- Auth: admin only.

### GET /settings/initial-balance
- Tidak ada params.
- Response: `{ initial_balance: number }`
- Auth: admin only.

### PATCH /settings/initial-balance
- Body (JSON): `initial_balance` (wajib, number)
- Response: `{ initial_balance: number }`
- Auth: admin only.

---

## Catatan validasi (zodSchema.ts)

- `UserDTO` (dipakai `register`): email opsional (boleh string kosong), username min 5, password min 8 opsional, role enum (7 role), address/position opsional, phone_number opsional (digit saja 10-15), image_url opsional.
- `UpdateProfileDTO`: sama seperti UserDTO minus email/role/password, semua opsional.
- `PushTokenDTO`: `pushToken` wajib string.
- `InventoryDTO` / `InventoryUpdateDTO`: `name` string, `quantity` **string** (bukan number), `image_url` opsional.
- Endpoint iuran, event, dan danaMasuk **tidak** pakai Zod DTO — validasi manual inline di controller.
