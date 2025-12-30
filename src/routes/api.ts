import express from "express";
import authController from "../controller/auth.controller";
import iuranController from "../controller/iuran.controller";
import keuanganController from "../controller/keuangan.controller";
import aclMiddleware from "../middleware/acl.middleware";
import authMiddleware from "../middleware/auth.middleware";
import mediaMiddleware from "../middleware/media.middleware";
import { ROLES } from "../utils/constants";
import inventoryController from "../controller/inventory.controller";
import eventController from "../controller/event.controller";

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
router.get("/user", authMiddleware, authController.findAll);
router.delete(
  "/user/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  authController.deleteUser
);

//Iuran
router.get("/iuran", authMiddleware, iuranController.findAll);
router.get("/iuran/receipt", authMiddleware, iuranController.generateReceipt);

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

//Inventory
router.get("/inventory", authMiddleware, inventoryController.findAll);
router.get("/inventory/:id", authMiddleware, inventoryController.detail);
router.post("/inventory", [
  authMiddleware,
  aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT]),
  inventoryController.create,
]);
router.patch("/inventory/:id", [
  authMiddleware,
  aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT]),
  inventoryController.update,
]);
router.delete("/inventory/:id", [
  authMiddleware,
  aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT]),
  inventoryController.delete,
]);

//Event (Donations for events like 17 Agustus, Tahun Baru, etc.)
router.get(
  "/event",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  eventController.findAll
);
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
router.post(
  "/event/:id/expense",
  [
    authMiddleware,
    aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS]),
  ],
  mediaMiddleware.any(),
  eventController.addExpense
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

export default router;
