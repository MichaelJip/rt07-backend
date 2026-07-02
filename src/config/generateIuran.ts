import cron from "node-cron";
import userModel from "../models/user.model";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES, USER_STATUS } from "../utils/constants";
import notificationService from "../services/notification.service";

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function startMonthlyIuranGeneration() {
  // Run on 1st of every month at 00:01 AM - Create iuran for the current month only
  cron.schedule("1 0 1 * *", async () => {
    try {
      const currentPeriod = getCurrentPeriod();
      console.log(`Creating monthly iuran for all users for period ${currentPeriod}...`);

      // Find all ACTIVE users EXCEPT ADMIN (skip inactive, away, moved, and deleted users)
      const users = await userModel
        .find({
          role: { $ne: ROLES.ADMIN },
          status: USER_STATUS.ACTIVE,
          isDeleted: { $ne: true },
        })
        .select("_id role status");

      console.log(`Found ${users.length} users (excluding ADMIN)`);

      let createdCount = 0;

      for (const user of users) {
        const exists = await iuranModel.findOne({
          user: user._id,
          period: currentPeriod,
          type: "regular",
        });

        // Only create if doesn't exist (e.g., already paid in advance)
        if (!exists) {
          await iuranModel.create({
            user: user._id,
            period: currentPeriod,
            amount: "50000",
            type: "regular",
            status: IURAN_STATUS.UNPAID,
            submitted_at: null,
            confirmed_at: null,
            confirmed_by: null,
          });
          createdCount++;
        }
      }

      console.log(`Monthly iuran created: ${createdCount} records for period ${currentPeriod}!`);

      // Send push notification to all non-ADMIN users about new monthly iuran
      if (createdCount > 0) {
        const nonAdminRoles = [
          ROLES.RT,
          ROLES.RW,
          ROLES.BENDAHARA,
          ROLES.SEKRETARIS,
          ROLES.SATPAM,
          ROLES.WARGA,
        ];

        for (const role of nonAdminRoles) {
          await notificationService.sendToRole(role, {
            title: "Iuran Bulanan Baru 📋",
            body: `Iuran untuk periode ${currentPeriod} sudah tersedia. Silahkan lakukan pembayaran.`,
            data: {
              type: "new_monthly_iuran",
              period: currentPeriod,
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

  // Run on 10th of every month at 00:01 AM - Jatuh Tempo Reminder
  cron.schedule("1 0 10 * *", async () => {
    try {
      console.log("Sending Jatuh Tempo reminder notifications...");

      const currentPeriod = getCurrentPeriod();

      // Find all unpaid iuran for current month (including both regular and custom)
      const unpaidIuran = await iuranModel
        .find({
          period: currentPeriod,
          status: IURAN_STATUS.UNPAID,
        })
        .populate("user", "_id expoPushToken role")
        .select("user period amount note type");

      console.log(`Found ${unpaidIuran.length} unpaid iuran for month ${currentPeriod}`);

      // Group by user and send one notification per user with all their unpaid iuran
      const userUnpaidMap = new Map<string, typeof unpaidIuran>();

      for (const iuran of unpaidIuran) {
        if (iuran.user && typeof iuran.user === "object" && "_id" in iuran.user) {
          const userId = iuran.user._id.toString();
          if (!userUnpaidMap.has(userId)) {
            userUnpaidMap.set(userId, []);
          }
          userUnpaidMap.get(userId)?.push(iuran);
        }
      }

      // Send notification to each user with their unpaid iuran details
      for (const [userId, userIuran] of userUnpaidMap) {
        const totalAmount = userIuran.reduce((sum, iuran) => sum + Number(iuran.amount), 0);

        let bodyMessage = "";
        if (userIuran.length === 1) {
          const iuran = userIuran[0];
          const description = iuran.note ? ` - ${iuran.note}` : "";
          bodyMessage = `Jatuh Tempo! Lakukan pembayaran sekarang${description}. Jumlah: Rp ${Number(iuran.amount).toLocaleString("id-ID")}`;
        } else {
          const details = userIuran.map(i => {
            const desc = i.note ? ` (${i.note})` : "";
            return `Rp ${Number(i.amount).toLocaleString("id-ID")}${desc}`;
          }).join(", ");
          bodyMessage = `Jatuh Tempo! Anda memiliki ${userIuran.length} iuran yang belum dibayar: ${details}. Total: Rp ${totalAmount.toLocaleString("id-ID")}`;
        }

        await notificationService.sendToUser(userId, {
          title: "⚠️ Jatuh Tempo - Pembayaran Iuran",
          body: bodyMessage,
          data: {
            type: "jatuh_tempo_reminder",
            unpaidCount: userIuran.length,
            totalAmount: totalAmount.toString(),
          },
        });
      }

      console.log(`Jatuh Tempo notifications sent to ${userUnpaidMap.size} users`);
    } catch (error) {
      console.error("Error sending Jatuh Tempo notifications:", error);
    }
  });

  console.log("Jatuh Tempo reminder scheduled: 10th of every month at 00:01 AM");
}
