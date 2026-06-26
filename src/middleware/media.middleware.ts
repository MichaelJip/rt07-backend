import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../utils/cloudinary";

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "rt-backend",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    resource_type: "image",
  } as any,
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Excel / spreadsheet imports stay in memory (never go to Cloudinary)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export default {
  single(fieldName: string) {
    return imageUpload.single(fieldName);
  },
  array(fieldName: string, maxCount?: number) {
    return imageUpload.array(fieldName, maxCount);
  },
  any() {
    return imageUpload.any();
  },
  excelSingle(fieldName: string) {
    return excelUpload.single(fieldName);
  },
};
