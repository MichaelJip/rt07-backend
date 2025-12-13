import express from "express";
import authController from "../controller/auth.controller";
import iuranController from "../controller/iuran.controller";
import keuanganController from "../controller/keuangan.controller";
import aclMiddleware from "../middleware/acl.middleware";
import authMiddleware from "../middleware/auth.middleware";
import mediaMiddleware from "../middleware/media.middleware";
import { ROLES } from "../utils/constants";

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
router.get("/user", authMiddleware, authController.findAll);

//Iuran
router.get("/iuran", authMiddleware, iuranController.findAll);
router.get("/iuran/my-history", authMiddleware, iuranController.getMyHistory);
router.post(
  "/iuran/generate-monthly",
  [authMiddleware, aclMiddleware([ROLES.ADMIN])],
  iuranController.generateMonthlyIuran
);
router.get(
  "/iuran/status-summary/:period",
  authMiddleware,
  iuranController.getStatusSummary
);
router.get(
  "/iuran/history/period/:period",
  [authMiddleware, aclMiddleware([ROLES.BENDAHARA, ROLES.ADMIN, ROLES.RT])],
  iuranController.getHistoryByPeriod
);
router.get(
  "/iuran/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA, ROLES.RT])],
  iuranController.findOne
);
router.patch(
  "/iuran/:id/submit",
  [authMiddleware, aclMiddleware([ROLES.WARGA])],
  mediaMiddleware.single("proof_image_url"),
  iuranController.submitPayment
);
router.patch(
  "/iuran/:id/status",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  iuranController.updateStatus
);

// Laporan Keuangan (Financial Report)
router.get(
  "/keuangan/laporan",
  authMiddleware,
  keuanganController.getLaporanKeuangan
);

// Pengeluaran (Expenses)
router.post(
  "/pengeluaran",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  mediaMiddleware.any(),
  keuanganController.createPengeluaran
);
router.get(
  "/pengeluaran",
  authMiddleware,
  keuanganController.getAllPengeluaran
);
router.get(
  "/pengeluaran/:id",
  authMiddleware,
  keuanganController.getPengeluaranById
);
router.patch(
  "/pengeluaran/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  keuanganController.updatePengeluaran
);
router.delete(
  "/pengeluaran/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  keuanganController.deletePengeluaran
);

export default router;
