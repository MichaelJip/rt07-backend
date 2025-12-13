import cron from "node-cron";
import userModel from "../models/user.model";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import notificationService from "../utils/notification.service";

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function startMonthlyIuranGeneration() {
  // Run on 1st of every month at 00:01 AM
  cron.schedule("1 0 1 * *", async () => {
    try {
      console.log("Creating monthly iuran for all users except ADMIN...");

      const period = getCurrentPeriod();

      // Find all users EXCEPT ADMIN
      const users = await userModel
        .find({
          role: { $ne: ROLES.ADMIN },
        })
        .select("_id role");

      console.log(`Found ${users.length} users (excluding ADMIN)`);

      let createdCount = 0;

      for (const user of users) {
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
          createdCount++;
        }
      }

      console.log(`Monthly iuran created for ${createdCount} users!`);

      // Send push notification to all non-ADMIN users about new iuran
      if (createdCount > 0) {
        const nonAdminRoles = [
          ROLES.RT,
          ROLES.RW,
          ROLES.BENDAHARA,
          ROLES.SATPAM,
          ROLES.WARGA,
        ];

        for (const role of nonAdminRoles) {
          await notificationService.sendToRole(role, {
            title: "Iuran Bulanan Baru 📋",
            body: `Iuran bulanan untuk periode ${period} sudah tersedia. Silahkan lakukan pembayaran.`,
            data: {
              type: "new_iuran",
              period: period,
            },
          });
        }
        console.log(`Push notifications sent to all non-ADMIN users`);
      }
    } catch (error) {
      console.error("Error creating monthly iuran:", error);
    }
  });

  console.log("Monthly iuran generation scheduled: 1st of every month at 00:01 AM");
}
