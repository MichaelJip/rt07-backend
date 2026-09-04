# RT Backend — API Update: Data Keluarga

Endpoint baru/berubah dari branch `feature/family-tabungan-acara` (data keluarga & kepala
keluarga). **Belum merge ke `main`, belum deploy** — dokumen ini buat testing via Postman
dulu. Kalau sudah beres & merge, isinya dipindah ke
[API-REFERENCE.md](API-REFERENCE.md) dan file ini dihapus.

Base URL & auth header sama seperti [API-REFERENCE.md](API-REFERENCE.md): `Authorization: Bearer <token>`.

---

## GET /user/:id — baru, dipakai FE (halaman edit user full page)

- Params: `id`. Tidak ada query/body.
- Response: satu dokumen user lengkap (tanpa password) — termasuk `family_members` dan
  `birth_date`, tidak ada gate `?full=true` di sini karena route-nya sendiri sudah
  admin-only.
- 404 kalau id tidak ada / tidak valid.
- Auth: admin only.

---

## Settings — khusus Postman, TIDAK ada di website

Dua key setting baru, isinya dropdown reference data (bukan data warga). GET-nya publik
(butuh publik karena nantinya bisa dipakai form mana pun), tapi PATCH-nya admin only —
dan karena kamu belum bikin halaman settings di FE, cara satu-satunya update isinya
sekarang ya lewat Postman langsung.

### GET /settings/family-relations
- Tidak ada query/body.
- Response: `{ family_relations: [{ id, label }] }`
- Default kalau belum pernah di-PATCH:
  ```json
  [
    { "id": "suami", "label": "Suami" },
    { "id": "istri", "label": "Istri" },
    { "id": "anak", "label": "Anak" },
    { "id": "orang_tua", "label": "Orang Tua" },
    { "id": "mertua", "label": "Mertua" },
    { "id": "kerabat", "label": "Kerabat" },
    { "id": "famili_lain", "label": "Famili Lain" }
  ]
  ```
- Auth: tidak perlu.

### PATCH /settings/family-relations
- Body (JSON), **replace seluruh list** (bukan nambah satu). Tiap item wajib `label`;
  `id` **opsional per item**:
  - Nambah relasi baru → item tanpa `id`, nanti di-generate otomatis.
  - Ubah label relasi yang sudah ada tanpa mengubah referensinya di data warga → GET dulu,
    edit `label`-nya, PATCH balik dengan `id` yang sama persis (jangan dihapus).
  ```json
  {
    "family_relations": [
      { "id": "suami", "label": "Suami" },
      { "id": "istri", "label": "Istri" },
      { "id": "anak", "label": "Anak" },
      { "id": "orang_tua", "label": "Orang Tua" },
      { "id": "mertua", "label": "Mertua" },
      { "id": "kerabat", "label": "Kerabat" },
      { "id": "famili_lain", "label": "Famili Lain" },
      { "label": "Anak Tiri" }
    ]
  }
  ```
- 400 kalau ada `id` yang dobel setelah auto-generate, atau ada `label` yang sama persis (case-insensitive — "Anak" dan "anak" dianggap sama, biar dropdown-nya nggak nunjukin dua opsi keliatan identik).
- Response: `{ family_relations: [{ id, label }] }` (list yang baru, sudah termasuk id yang baru di-generate).
- Auth: admin only.
- **Penting:** field `relation` di anggota keluarga (lihat di bawah) isinya `id` ini, bukan `label`. Kalau nge-delete/ganti id yang masih dipakai warga, warga itu jadi nunjuk ke relasi yang nggak ada lagi — belum ada validasi buat cegah itu, jadi hati-hati sebelum hapus id yang sudah kepakai.

### GET /settings/age-categories
- Tidak ada query/body.
- Response: `{ age_categories: [{ label, min_age, max_age }] }`
- Default: Balita (0-5), Anak (6-12), Remaja (13-17), Dewasa (18-59), Lansia (60-200)
- Auth: tidak perlu.

### PATCH /settings/age-categories
- Body (JSON), **replace seluruh list**, tiap item wajib `label` (string), `min_age`/`max_age` (number, `max_age >= min_age`):
  ```json
  {
    "age_categories": [
      { "label": "Balita", "min_age": 0, "max_age": 5 },
      { "label": "Anak", "min_age": 6, "max_age": 12 },
      { "label": "Remaja", "min_age": 13, "max_age": 17 },
      { "label": "Dewasa", "min_age": 18, "max_age": 59 },
      { "label": "Lansia", "min_age": 60, "max_age": 200 }
    ]
  }
  ```
- Response: `{ age_categories: [...] }` (list yang baru).
- Auth: admin only.

---

## User — Family Members (anggota keluarga)

`family_members` nempel di dokumen `User` yang sudah ada — User itu sendiri = kepala
keluarga, `family_members[]` = sisa anggota rumah tangga (istri/anak/dll).

### POST /user/:id/family
Tambah satu anggota keluarga ke user `:id`.
- Params: `id` (User ID, si kepala keluarga)
- Body (JSON):
  ```json
  {
    "name": "Budi",
    "birth_date": "2015-03-12",
    "relation": "anak"
  }
  ```
- `relation` isinya **`id`** dari `GET /settings/family-relations` (bukan `label`) — kalau tidak cocok dengan salah satu `id` yang ada, 400 dengan pesan daftar `id (label)` yang valid.
- Response: dokumen user lengkap (termasuk `family_members[]` yang sudah update).
- Auth: admin only.

### PATCH /user/:id/family/:memberId
Update sebagian field satu anggota keluarga.
- Params: `id` (User ID), `memberId` (`_id` dari salah satu item `family_members`)
- Body (JSON) — semua field opsional, kirim yang mau diubah saja:
  ```json
  { "name": "Budi Santoso" }
  ```
- Auth: admin only.

### DELETE /user/:id/family/:memberId
Hapus satu anggota keluarga.
- Params: `id`, `memberId`. Tidak ada body.
- Response: dokumen user lengkap (tanpa anggota yang dihapus).
- Auth: admin only.

---

## GET /user — berubah (dipakai FE, bukan cuma Postman)

Endpoint yang sudah ada, dua tambahan:

- **Search sekarang juga cek nama anggota keluarga.** Cari "Budi" (anak) akan tetap
  return user Michael (kepala keluarganya) — bukan user Budi terpisah, karena Budi bukan
  akun sendiri.
- **Query baru** `minAge`, `maxAge` (integer, opsional, bisa dipakai bareng atau
  sendiri-sendiri) — filter household yang punya siapa pun (kepala keluarga atau anggota
  keluarga) dengan usia di rentang itu. Contoh: `GET /user?minAge=0&maxAge=5&full=true` →
  semua KK yang punya balita.
- `family_members` dan `birth_date` tetap **privileged-only** (sama seperti `email`
  sekarang) — cuma muncul kalau `full=true` + token role admin/bendahara/sekretaris/rt/rw.
  Response publik (tanpa `full=true`) tidak berubah sama sekali.

## PATCH /user/:id — tambahan field

- Body sekarang bisa juga kirim `birth_date` (opsional, `YYYY-MM-DD`) — ini tanggal lahir
  kepala keluarga sendiri (bukan anggota keluarga, itu lewat endpoint `/family` di atas).

---

## Ringkasan: apa yang perlu diubah di FE

1. **Form tambah/edit/hapus anggota keluarga** di halaman detail/edit user (admin panel) — panggil `POST/PATCH/DELETE /user/:id/family[/:memberId]`.
2. **Dropdown "Relasi"** di form itu — isinya fetch dari `GET /settings/family-relations` (dapat `[{id,label}]`), tampilkan `label`, tapi yang dikirim balik ke `POST/PATCH /user/:id/family` adalah `id`-nya, bukan `label`. Jangan di-hardcode di FE, karena admin bisa nambah dari Postman kapan saja.
3. **Field "Tanggal Lahir"** di form edit user (untuk kepala keluarga sendiri) — kirim `birth_date` ke `PATCH /user/:id`.
4. **Search box** yang sudah ada: tidak perlu ubah UI apa-apa, hasilnya otomatis lebih pintar (nemu by nama anak juga).
5. **(Opsional)** kalau mau ada filter usia di UI (misal untuk cari data balita/lansia): tinggal kirim `?minAge=&maxAge=` ke `GET /user` yang sudah dipakai sekarang.
6. **Settings (family-relations & age-categories): TIDAK perlu dikerjakan di FE** — sesuai keputusan kamu, ini cuma kamu yang akses, cukup lewat Postman pakai dokumen ini.
