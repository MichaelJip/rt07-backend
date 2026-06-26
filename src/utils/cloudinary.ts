import { v2 as cloudinary } from "cloudinary";
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } from "./env";

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

export const deleteCloudinaryImage = async (imageUrl: string): Promise<void> => {
  try {
    // Extract public_id from Cloudinary URL
    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/rt-backend/abc123.jpg
    const match = imageUrl.match(/\/rt-backend\/([^/.]+)/);
    if (match) {
      await cloudinary.uploader.destroy(`rt-backend/${match[1]}`);
    }
  } catch {
    // Silently ignore if image doesn't exist on Cloudinary
  }
};

export default cloudinary;
