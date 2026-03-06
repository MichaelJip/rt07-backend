import express from "express";
import authController from "../controller/auth.controller";
import iuranController from "../controller/iuran.controller";
import keuanganController from "../controller/keuangan.controller";
import settingsController from "../controller/settings.controller";
import aclMiddleware from "../middleware/acl.middleware";
import authMiddleware from "../middleware/auth.middleware";
import mediaMiddleware from "../middleware/media.middleware";
import { ROLES } from "../utils/constants";
import inventoryController from "../controller/inventory.controller";
import eventController from "../controller/event.controller";
import danaMasukController from "../controller/danaMasuk.controller";

const router = express.Router();

//Auth
router.post(
  "/auth/register",
  mediaMiddleware.single("image_url"),
  authController.register
);
router.post("/auth/login", authController.login);
router.get("/auth/me", authMiddleware, authController.me);
router.post("/auth/push-token", authMiddleware, authController.updatePushToken);
router.patch(
  "/auth/profile",
  authMiddleware,
  mediaMiddleware.single("image_url"),
  authController.updateProfile
);
// router.get("/user", authMiddleware, authController.findAll);
router.get("/user", authController.findAll);
// User Import/Export
router.get("/user/template/download", authController.downloadTemplate);
router.post(
  "/user/import",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  mediaMiddleware.single("file"),
  authController.importUsers
);
router.get(
  "/user/export",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  authController.exportUsers
);
router.delete(
  "/user/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  authController.deleteUser
);
router.patch(
  "/user/:id/status",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  authController.updateUserStatus
);
router.post(
  "/user/:id/restore",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  authController.restoreUser
);

//Iuran
router.get("/iuran", authMiddleware, iuranController.findAll);
router.get("/iuran/receipt", authMiddleware, iuranController.generateReceipt);
router.get("/iuran/template/download", iuranController.downloadTemplate);
router.get(
  "/iuran/export",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  iuranController.exportIuran
);
router.get("/iuran/status-summary/:period", iuranController.getStatusSummary);
router.post(
  "/iuran/record-payment",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  iuranController.recordPayment
);
router.post(
  "/iuran/create-yearly",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  iuranController.createYearlyIuran
);
// Iuran Import/Export
router.post(
  "/iuran/import",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  mediaMiddleware.single("file"),
  iuranController.importIuran
);


// Laporan Keuangan (Financial Report) - Public
router.get("/keuangan/laporan", keuanganController.getLaporanKeuangan);

// Pengeluaran (Expenses)
router.post(
  "/pengeluaran",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  mediaMiddleware.any(),
  keuanganController.createPengeluaran
);
router.get("/pengeluaran", keuanganController.getAllPengeluaran);
router.get("/pengeluaran/slug/:slug", keuanganController.getPengeluaranBySlug);
router.get("/pengeluaran/:id", keuanganController.getPengeluaranById);
router.patch(
  "/pengeluaran/:id",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  mediaMiddleware.any(),
  keuanganController.updatePengeluaran
);
router.delete(
  "/pengeluaran/:id",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  keuanganController.deletePengeluaran
);

//Inventory - GET list is public for rt07-website display
router.get("/inventory", inventoryController.findAll);
router.get("/inventory/:id", inventoryController.detail);
router.post(
  "/inventory",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT])],
  mediaMiddleware.single("image_url"),
  inventoryController.create
);
router.patch(
  "/inventory/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT])],
  mediaMiddleware.single("image_url"),
  inventoryController.update
);
router.delete("/inventory/:id", [
  authMiddleware,
  aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT]),
  inventoryController.delete,
]);

router.get(
  "/event",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.findAll
);
router.get("/event/slug/:slug", eventController.findBySlug);
router.get(
  "/event/:id",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.findOne
);
router.post(
  "/event",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.create
);
router.patch(
  "/event/:id",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.update
);
router.delete(
  "/event/:id",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.delete
);
router.post(
  "/event/:id/donation",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.addDonation
);
router.patch(
  "/event/:id/donation/:donationId",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.updateDonation
);
router.delete(
  "/event/:id/donation/:donationId",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.deleteDonation
);
router.post(
  "/event/:id/expense",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  mediaMiddleware.any(),
  eventController.addExpense
);
router.patch(
  "/event/:id/expense/:expenseId",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.updateExpense
);
router.delete(
  "/event/:id/expense/:expenseId",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.deleteExpense
);
router.post(
  "/event/:id/complete",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.completeEvent
);
router.get(
  "/event/:id/download-report",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.downloadEventReport
);

// Dana Masuk (Fund Injection) - GET is public, POST/DELETE admin only
router.get("/dana-masuk", danaMasukController.findAll);
router.post(
  "/dana-masuk",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  danaMasukController.create
);
router.delete(
  "/dana-masuk/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  danaMasukController.delete
);

// Settings (Admin only)
router.get(
  "/settings",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  settingsController.getAll
);
router.get(
  "/settings/initial-balance",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  settingsController.getInitialBalance
);
router.patch(
  "/settings/initial-balance",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  settingsController.updateInitialBalance
);

export default router;
