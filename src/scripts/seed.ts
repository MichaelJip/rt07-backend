import dotenv from "dotenv";
import mongoose from "mongoose";
import userModel from "../models/user.model";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import connectDB from "../utils/database";

dotenv.config();

const STATUSES = [
  IURAN_STATUS.PAID,
  IURAN_STATUS.REJECTED,
  IURAN_STATUS.PENDING,
  IURAN_STATUS.UNPAID,
];

// Helper function to get period string (YYYY-MM)
function getPeriod(monthsAgo: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Helper function to get random status with distribution
function getRandomStatus(monthsAgo: number): string {
  // Older months more likely to be paid
  if (monthsAgo >= 3) {
    const rand = Math.random();
    if (rand < 0.6) return IURAN_STATUS.PAID; // 60% paid for older months
    if (rand < 0.8) return IURAN_STATUS.REJECTED; // 20% rejected
    if (rand < 0.9) return IURAN_STATUS.PENDING; // 10% pending
    return IURAN_STATUS.UNPAID; // 10% unpaid
  } else {
    // Recent months more varied
    const rand = Math.random();
    if (rand < 0.3) return IURAN_STATUS.PAID; // 30% paid
    if (rand < 0.5) return IURAN_STATUS.REJECTED; // 20% rejected
    if (rand < 0.75) return IURAN_STATUS.PENDING; // 25% pending
    return IURAN_STATUS.UNPAID; // 25% unpaid
  }
}

// Helper function to get date for a period
function getDateForPeriod(monthsAgo: number, daysOffset: number = 0): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsAgo);
  date.setDate(date.getDate() - daysOffset);
  return date;
}

async function seed() {
  try {
    console.log("🌱 Starting seeder...");

    // Connect to database
    await connectDB();
    console.log("✅ Connected to database");

    // Check if users already exist
    const existingBendahara = await userModel.findOne({
      username: "bendahara",
    });
    const existingWarga = await userModel.findOne({ username: "warga1" });

    if (existingBendahara && existingWarga) {
      console.log(
        "⚠️  Users already exist. Skipping user creation to avoid duplicates."
      );
      await mongoose.connection.close();
      console.log("✅ Seeder completed (no changes made)");
      process.exit(0);
    }

    // 1. Create Bendahara user
    console.log("\n📝 Creating Bendahara user...");
    let bendahara;

    if (!existingBendahara) {
      bendahara = await userModel.create({
        username: "bendahara",
        email: "bendahara@test.com",
        password: "password123",
        role: ROLES.BENDAHARA,
      });
      console.log("✅ Created user: bendahara");
    } else {
      bendahara = existingBendahara;
      console.log("ℹ️  User bendahara already exists, using existing user");
    }

    // 2. Create 5 Warga users
    console.log("\n📝 Creating Warga users...");
    const wargaUsers = [];

    for (let i = 1; i <= 5; i++) {
      const existingWargaUser = await userModel.findOne({
        username: `warga${i}`,
      });

      if (!existingWargaUser) {
        const warga = await userModel.create({
          username: `warga${i}`,
          email: `warga${i}@test.com`,
          password: "password123",
          role: ROLES.WARGA,
        });
        wargaUsers.push(warga);
        console.log(`✅ Created user: warga${i}`);
      } else {
        wargaUsers.push(existingWargaUser);
        console.log(`ℹ️  User warga${i} already exists, using existing user`);
      }
    }

    // 3. Create Iuran records for each Warga user (5 months of history)
    console.log("\n📝 Creating Iuran records (5 months history)...");

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const warga of wargaUsers) {
      console.log(`\n  Processing user: ${warga.username}`);

      // Create iuran for 5 months (4 months ago to current month)
      for (let monthsAgo = 4; monthsAgo >= 0; monthsAgo--) {
        const period = getPeriod(monthsAgo);

        // Check if iuran already exists for this user and period
        const existingIuran = await iuranModel.findOne({
          user: warga._id,
          period,
        });

        if (existingIuran) {
          console.log(`    ⏭️  Skipped ${period} (already exists)`);
          totalSkipped++;
          continue;
        }

        const status = getRandomStatus(monthsAgo);
        const iuranData: any = {
          user: warga._id,
          period,
          amount: "50000",
          proof_image_url: "placeholder.jpg",
          status,
        };

        // Add dates based on status
        if (status === IURAN_STATUS.PENDING) {
          iuranData.submitted_at = getDateForPeriod(monthsAgo, 5);
        } else if (status === IURAN_STATUS.REJECTED) {
          iuranData.submitted_at = getDateForPeriod(monthsAgo, 7);
        } else if (status === IURAN_STATUS.PAID) {
          iuranData.submitted_at = getDateForPeriod(monthsAgo, 10);
          iuranData.confirmed_at = getDateForPeriod(monthsAgo, 3);
          iuranData.confirmed_by = bendahara._id;
        }

        await iuranModel.create(iuranData);
        console.log(`    ✅ Created ${period} (status: ${status})`);
        totalCreated++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Users created: ${existingBendahara ? 0 : 1} Bendahara + ${wargaUsers.filter((u) => !u.createdAt || u.createdAt > new Date(Date.now() - 10000)).length} Warga`);
    console.log(`   Iuran records created: ${totalCreated}`);
    console.log(`   Iuran records skipped: ${totalSkipped}`);

    // Close database connection
    await mongoose.connection.close();
    console.log("\n✅ Seeder completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeder failed:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeder
seed();
