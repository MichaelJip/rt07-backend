import express from "express";
import authController from "../controller/auth.controller";
import iuranController from "../controller/iuran.controller";
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

//Iuran
// router.post(
//   "/iuran/create",
//   authMiddleware,
//   mediaMiddleware.single("proof_image_url"),
//   iuranController.create
// );
router.patch(
  "/iuran/:id/submit",
  [authMiddleware, aclMiddleware([ROLES.WARGA])],
  mediaMiddleware.single("proof_image_url"),
  iuranController.submitPayment
);
router.get("/iuran", authMiddleware, iuranController.findAll);
router.get(
  "/iuran/:id",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  iuranController.findOne
);
router.patch(
  "/iuran/:id/status",
  [authMiddleware, aclMiddleware([ROLES.ADMIN, ROLES.BENDAHARA])],
  iuranController.updateStatus
);

export default router;
