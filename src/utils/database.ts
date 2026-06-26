import mongoose from "mongoose";
import { DATABASE_URL } from "./env";

let isConnected = false;

const connect = async () => {
  if (isConnected) return "Database already connected!";

  try {
    await mongoose.connect(DATABASE_URL, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    isConnected = true;
    return "Database connected!";
  } catch (error) {
    return Promise.reject(error);
  }
};

export default connect;
