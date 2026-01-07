import mongoose from "mongoose";
import pengeluaranModel from "../models/pengeluaran.model";
import { generateSlug, generateUniqueSlug } from "../utils/slugGenerator";
import dotenv from "dotenv";

dotenv.config();

async function addSlugsToPengeluaran() {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/rt-db";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const pengeluaranWithoutSlug = await pengeluaranModel.find({
      $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
    });

    console.log(
      `Found ${pengeluaranWithoutSlug.length} pengeluaran without slugs`
    );

    if (pengeluaranWithoutSlug.length === 0) {
      console.log("All pengeluaran already have slugs!");
      await mongoose.connection.close();
      return;
    }

    const existingSlugs: string[] = [];

    for (const pengeluaran of pengeluaranWithoutSlug) {
      const baseSlug = generateSlug(pengeluaran.title);
      const slug = generateUniqueSlug(baseSlug, existingSlugs);

      existingSlugs.push(slug);

      await pengeluaranModel.findByIdAndUpdate(pengeluaran._id, { slug });

      console.log(`Added slug "${slug}" to pengeluaran: ${pengeluaran.title}`);
    }

    console.log(
      `Successfully added slugs to ${pengeluaranWithoutSlug.length} pengeluaran`
    );

    await mongoose.connection.close();
    console.log("Database connection closed");
  } catch (error) {
    console.error("Error adding slugs to pengeluaran:", error);
    process.exit(1);
  }
}

addSlugsToPengeluaran();
