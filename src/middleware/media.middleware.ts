import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "uploads/";

    if (file.fieldname === "image_url") {
      uploadPath = "uploads/profile/";
    } else if (file.fieldname === "proof_image_url") {
      const period = req.body.period || new Date().toISOString().slice(0, 7); // e.g., "2025-01"
      uploadPath = `uploads/payments/${period}/`;
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
});

export default {
  single(fieldName: string) {
    return upload.single(fieldName);
  },
};
