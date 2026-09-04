# AGENTS.md — RT Backend

Orientation doc for AI agents working in this repo. For deployment/ops, see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/MAINTENANCE-GUIDE.md](docs/MAINTENANCE-GUIDE.md).
Keep this file updated when routes, models, or architecture change.

## Stack

- Express.js 5 + TypeScript (commonjs), run via `ts-node`/`nodemon` in dev
- MongoDB + Mongoose, Zod for validation/DTO inference
- `node-cron` for scheduled jobs, `expo-server-sdk` for push notifications
- PM2 in production (`ecosystem.config.js`), deployed behind nginx (see deploy docs)

## Entry point & wiring

- [src/index.ts](src/index.ts) — bootstraps: DB connect → express app → CORS/body-parser →
  mounts API router at `/api` → serves `/uploads` and `/receipts` as static dirs →
  error middleware → starts cron (`startMonthlyIuranGeneration`) → listens on port 3000.
- [src/routes/api.ts](src/routes/api.ts) — **single file**, all routes registered here.
  When adding an endpoint, add it here (grouped by resource, in existing style).

## Directory layout

| Path | Purpose |
|---|---|
| `src/models/` | Mongoose schemas — User, Iuran, Event, Pengeluaran, Inventory, Settings, DanaMasuk |
| `src/controller/` | Route handlers, one file per resource, `export default { handlerName, ... }` |
| `src/routes/api.ts` | All route definitions (path, middleware chain, handler) |
| `src/middleware/` | `auth` (JWT), `acl` (role check), `media` (multer upload), `error` (404/500) |
| `src/services/notification.service.ts` | Expo push notification sending (`sendToUser`, `sendToUsers`, `sendToRole`) |
| `src/config/generateIuran.ts` | Cron jobs (monthly iuran generation + jatuh tempo reminders) |
| `src/utils/` | `constants` (enums), `env`, `database`, `jwt`, `encryption`, `zodSchema` (DTOs), `interface` (IReqUser etc.), `response` (standard API response shape), `excelReportGenerator`/`excelTemplate`/`pdfGenerator`/`slugGenerator` |
| `src/scripts/` | One-off/migration scripts run via `ts-node` (see `package.json` `migrate:*` scripts), plus `seed.ts` and `clear-uploads.ts` |

## Auth & authorization

- JWT bearer token via `Authorization: Bearer <token>` → `auth.middleware.ts` decodes and
  attaches `req.user` (see `IReqUser` in `utils/interface.ts`).
- `acl.middleware.ts` takes an array of allowed `ROLES` and 403s if `req.user.role` isn't in it.
- Roles (`utils/constants.ts`): `admin, rt, rw, bendahara, sekretaris, satpam, warga`.
- Many GET endpoints are intentionally public (no `authMiddleware`) for the public-facing
  website — e.g. `/user`, `/inventory`, `/dana-masuk`, `/keuangan/laporan`,
  `/event/slug/:slug`, `/pengeluaran*`. Check `api.ts` before assuming an endpoint needs auth.

## Domain models

- **User** (`user.model.ts`) — `email` optional except for `admin` (required only there),
  `sparse: true` index so multiple nulls don't collide with uniqueness. `password` hashed
  via `encrypt()` in a pre-save hook; stripped from `toJSON()`. Soft-delete via
  `isDeleted`/`deletedAt`. Status enum below controls iuran generation behavior.
- **Iuran** (`iuran.model.ts`) — one doc per user per period. `type: regular | custom`.
  `status: unpaid | pending | paid | rejected`. Regular iuran are auto-created by cron;
  custom iuran are ad-hoc (e.g. event dues) created manually.
- **Event** (`event.model.ts`) — has embedded `donations[]` and `expenses[]` subdocuments;
  `total_donations`/`total_expenses`/`balance` are recalculated in a pre-save hook.
  `status: planning | active | completed`. Completing an event can spin off a linked
  `Pengeluaran` record (see `event_id` on Pengeluaran).
- **Pengeluaran** (expenses ledger) — `items[]` with `name/price/image_url`, `total`.
  Optionally linked to the `Event` that generated it via `event_id`.
- **DanaMasuk** (fund injections) — simple `nama_pemberi/nominal/keterangan` ledger entry,
  contributes to balance.
- **Inventory** — `name` (unique), `quantity`, optional `image_url`. Public GET for the
  website. DELETE also removes the uploaded image file from disk.
- **Settings** — generic `key/value` (Mixed) store; currently used for `initial_balance`.

### User status enum (drives cron/iuran behavior)

- `active` — normal; iuran generated monthly.
- `inactive` — rumah kosong; no new iuran, unpaid iuran deleted.
- `away` — temporarily away.
- `moved` — moved out; login blocked (same iuran handling as `inactive`, but also
  blocks auth).

### Balance formula

`initial_balance + paid_iuran + event_donations + dana_masuk - pengeluaran`
— computed by `getCurrentBalance()`, exported from `keuangan.controller.ts`.

## Cron jobs (`src/config/generateIuran.ts`)

- **1st of month, 00:01** — creates `regular` iuran for the *current month only* for all
  `active`, non-admin, non-deleted users (skips if already exists, e.g. paid in advance).
  Sends push notification to all non-admin roles.
- **10th of month, 00:01** — "jatuh tempo" reminder: pushes a notification per user
  listing all their unpaid iuran for the current period.
- Same monthly-iuran generation pattern (create up to current month only, next month
  handled by cron) also applies to register, Excel import, restore, and reactivation flows
  — keep these consistent if you touch iuran-generation logic.

## Key non-obvious patterns

- `userModel.create(data) as any` when creating from an untyped/dynamic object, to avoid
  TS friction — an established pattern in this codebase, not a one-off hack.
- Password is required only for `admin`; other roles default to `"password123"` if omitted.
  `phone_number` is optional for all roles.
- Register accepts an optional `created_at` (`YYYY-MM` or `YYYY-MM-DD`, must not be in the
  future) which overrides `user.createdAt` and backfills iuran from that month through the
  current month.
- `GET /user` (public) returns only safe fields (`_id, username, address, phone_number,
  status, role, image_url, unpaidIuranCount`) — no email/expoPushToken. Pass `?full=true`
  with an authenticated privileged token to get full records.

## Notable endpoints (non-exhaustive — see [api.ts](src/routes/api.ts) for the full list)

- `POST /iuran/advance-payment` — pay up to 2 years ahead (admin/bendahara/sekretaris).
- `POST /iuran/revert-payment` — admin/bendahara/sekretaris; undo mistaken payments.
  Body: `{ ids: string[] }` (Iuran document `_id`s, not periods). `regular` iuran are
  reset to `unpaid` (slot stays, payment fields cleared); `custom` iuran are deleted
  outright. Non-`paid` ids are skipped and reported in `errors`, not treated as fatal.
- `DELETE /iuran/cleanup-future` — admin only; deletes unpaid *regular* iuran with
  period beyond the current month (paid/advance/custom untouched).
- `GET /iuran/export` — admin/bendahara/sekretaris; exports an Excel matrix (users ×
  month) of all `paid` iuran only, no query params. Month columns are derived from the
  earliest/latest paid period found in the data (not a fixed year range).
- `PATCH|DELETE /event/:id/donation/:donationId`, `/event/:id/expense/:expenseId` —
  edit/remove event donations & expenses (kas re-checked if event already `completed`).
- `GET|POST /dana-masuk`, `DELETE /dana-masuk/:id` — fund injection ledger (GET public).
- `GET /inventory` — public, for the RT website.

## Env vars

`DATABASE_URL`, `SECRET` (JWT signing secret) — see `.env.example` and `src/utils/env.ts`.

## Scripts (`package.json`)

- `npm run dev` — nodemon + ts-node
- `npm run seed` — `src/scripts/seed.ts`
- `npm run migrate:*` — one-off data migrations (add slugs, link pengeluaran↔event)
- `npm run clear-uploads` — purge orphaned files in `uploads/`
- `npm run build` / `npm start` — compile to `dist/` and run compiled output

## Related frontend

The admin/user-management UI lives in a sibling repo, `rt07-frontend-website`
(see working directories `lib/validations`, `components/admin/User`). Keep DTOs
(`utils/zodSchema.ts`) and frontend validation schemas in sync when changing user/iuran
shapes.

## Planned updates — family/KK, area report, event savings (not yet implemented)

Design decided 4 Sep 2026 (Jumat, 4 September 2026), implementation not started. Move each
piece into "Domain models" / "Notable endpoints" / Changelog once it actually ships, and
delete the corresponding bullet here.

### 1. Family members / kepala keluarga
- Each existing `User` (warga) doc *is* the kepala keluarga — no separate head-of-family
  designation needed.
- Add `family_members: [{ name, birth_date, relation, ... }]` as an embedded subdocument
  array directly on `User` (same embedded-array pattern as `Event.donations[]`/
  `expenses[]`), not a separate collection.
- `relation` is **not** a hardcoded enum — it's admin-configurable reference data (mirrors
  real KK/Kartu Keluarga categories: suami, istri, anak, mertua, kerabat, etc., and RT
  wants to be able to add more without a code change). Same treatment for age-bracket
  categories used in reporting (item 2 below) — both are small reference lists an admin
  manages, not values baked into the schema/enum.
- `age` derived from `birth_date` at read time (virtual/computed), never stored.
- Age-range filtering (e.g. `?minAge=&maxAge=`) is a query filter over `family_members`
  ages — for RT programs that need counts like balita/lansia.
- **Search must match family members, not just the head of household.** Searching "Adi"
  (a child) and searching "Michael" (the parent/kepala keluarga) must both surface the
  same household. Extend the existing user-search query with an `$or` on
  `family_members.name` alongside the current fields (username/address) — a match inside
  `family_members` still returns the parent `User` doc, which already carries the full
  `family_members[]`, so no extra shaping needed on the response side.
- **`family_members` are never billed.** `Iuran` generation/counting stays keyed on
  `User` only and is completely unaffected by household size — family members are
  informational, not billable entities. Don't let iuran logic scale with
  `family_members.length`.
- Open question (defaulted, confirm before building): is `family_members` privileged-only
  like `email`, or exposed on public `GET /user`? Default assumption: privileged-only.

### 2. Laporan luar daerah vs dalam daerah (patokan Kota Tangerang)
- Computed at report/export time, **not a stored field** — classify by matching `address`
  against "Kota Tangerang" (case-insensitive substring). Mirrors how `GET /iuran/export`
  already derives report shape from live data instead of persisting derived fields.
- Scope: `isDeleted: { $ne: true }`, `status != MOVED` (moved users stay in the DB but drop
  out of this report). `ACTIVE` and `AWAY` included. `INACTIVE` (rumah kosong, no resident)
  excluded by default — confirm if that's wrong.
- Implementation: new export endpoint following the existing `excelReportGenerator`
  pattern used by `iuran.controller.ts`.

### 3. Event savings ("tabungan acara" — trip/long-term savings, separate from donation-based Event)
- New dedicated model, *not* an extension of `event.model.ts` — keeps the existing
  one-off donation/expense Event flow untouched. Working name: `Tabungan` /
  `EventTabungan` (avoid colliding with the existing `Event` model name). Optional
  `linked_event_id` reserved for future integration into the Event section — not required
  at launch.
- Structure (mirrors `Event`'s embedded-array + pre-save total pattern):
  - `title`, `description`, `event_date` (nullable until finalized), `status`
    (`planning|active|completed`), `created_by`.
  - `participants: [{ user (ref User), goal_amount, total_saved (computed), joined_at,
    contributions: [{ amount, date, note, recorded_by (ref User), updated_by, updatedAt }]
    }]`.
  - `total_saved` recalculated in a pre-save hook, same approach as
    `Event.total_donations`.
- Participant = a `User` (the KK), not an individual family member — avoids ambiguity
  about whether a goal multiplies by household size. `goal_amount` is set per participant
  by the admin managing the event; actual contributions are free-form amounts (whatever
  the resident hands over), unlike the fixed monthly slots `Iuran` uses.
- Every contribution records `recorded_by`; edits/deletes record `updated_by`/`updatedAt`
  for traceability (same audit spirit as `revert-payment`).
- Public: list + detail (slug-based, like `/event/slug/:slug`) shows participants and each
  one's `total_saved` vs `goal_amount`. Individual contribution line items stay
  admin-only by default — confirm before launch if the public view should show the full
  ledger instead of just totals.

## Changelog

Log notable changes here — date, time, and what changed. Newest entry first.

- **Jumat, 4 September 2026** — Fix: user yang di-soft-delete (`isDeleted: true`) tetap
  mengunci username/email-nya sehingga tidak bisa dipakai ulang. Ditambahkan filter
  `isDeleted: { $ne: true }` ke semua pengecekan uniqueness username/email di
  [auth.controller.ts](src/controller/auth.controller.ts): `register`, `updateProfile`,
  `updateUser`, dan `importUsers` (4 titik, bukan cuma `register`).

- **Jumat, 21 Agustus 2026** — `GET /iuran/export` (`iuranController.exportIuran` di
  [iuran.controller.ts](src/controller/iuran.controller.ts)) diubah dari filter
  `startYear`/`endYear` (query params) jadi export semua iuran ber-status `paid`
  langsung, tanpa params. Kolom bulan di worksheet diturunkan dari periode
  paling awal/akhir yang ada di data, bukan lagi rentang tahun tetap.
- **Selasa, 11 Agustus 2026, 21:47** — Merapikan dokumentasi: `DEPLOYMENT.md`,
  `MAINTENANCE-GUIDE.md`, dan `backup-drive-guide.md` dipindah ke folder `docs/`
  (pakai `git mv` agar history terjaga). `README.md` dan `AGENTS.md` tetap di root
  supaya tetap ter-baca otomatis oleh GitHub/tools. Link referensi di baris atas
  file ini diupdate mengikuti lokasi baru.
- **Selasa, 11 Agustus 2026, 21:42** — Menambahkan `POST /iuran/revert-payment`
  (`iuranController.revertPayment` di [iuran.controller.ts](src/controller/iuran.controller.ts),
  route di [api.ts](src/routes/api.ts)) untuk membatalkan pembayaran iuran yang salah
  input (mis. salah bayar beberapa bulan sekaligus). Terima `{ ids: string[] }`;
  iuran `regular` di-reset ke `unpaid`, iuran `custom` dihapus. Tidak perlu update
  field saldo manual — `getCurrentBalance()` menghitung ulang otomatis dari status
  `paid`.
