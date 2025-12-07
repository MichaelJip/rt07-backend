import cron from "node-cron";
import userModel from "../models/user.model";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function startMonthlyIuranGeneration() {
  cron.schedule("0 0 28 * *", async () => {
    try {
      console.log("Creating monthly iuran for WARGA...");

      const period = getCurrentPeriod();

      const wargaUsers = await userModel
        .find({
          role: ROLES.WARGA,
        })
        .select("_id");

      console.log(`Found ${wargaUsers.length} warga users`);

      for (const user of wargaUsers) {
        const exists = await iuranModel.findOne({
          user: user._id,
          period: period,
        });

        // Only create if doesn't exist
        if (!exists) {
          await iuranModel.create({
            user: user._id,
            period: period,
            amount: "50000",
            status: IURAN_STATUS.UNPAID,
            submitted_at: null,
            confirmed_at: null,
            confirmed_by: null,
          });
        }
      }

      console.log(`Monthly iuran created for ${wargaUsers.length} warga!`);
    } catch (error) {
      console.error("Error creating monthly iuran:", error);
    }
  });
}
