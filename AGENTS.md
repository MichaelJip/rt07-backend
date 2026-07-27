# AGENTS.md — RT Backend

Orientation doc for AI agents working in this repo. For deployment/ops, see
[DEPLOYMENT.md](DEPLOYMENT.md) and [MAINTENANCE-GUIDE.md](MAINTENANCE-GUIDE.md).
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
- `DELETE /iuran/cleanup-future` — admin only; deletes unpaid *regular* iuran with
  period beyond the current month (paid/advance/custom untouched).
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
