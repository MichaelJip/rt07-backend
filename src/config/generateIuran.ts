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
  // Run on January 1st at 00:01 AM - Create yearly iuran for all users
  cron.schedule("1 0 1 1 *", async () => {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      console.log(`Creating yearly iuran for all users for year ${currentYear}...`);

      // Find all ACTIVE users EXCEPT ADMIN (skip inactive, away, and deleted users)
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
        // Create iuran for all 12 months
        for (let month = 1; month <= 12; month++) {
          const period = `${currentYear}-${String(month).padStart(2, "0")}`;

          const exists = await iuranModel.findOne({
            user: user._id,
            period: period,
            type: "regular",
          });

          // Only create if doesn't exist
          if (!exists) {
            await iuranModel.create({
              user: user._id,
              period: period,
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
      }

      console.log(`Yearly iuran created: ${createdCount} records for ${users.length} users!`);

      // Send push notification to all non-ADMIN users about new yearly iuran
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
            title: "Iuran Tahunan Baru 📋",
            body: `Iuran untuk tahun ${currentYear} sudah tersedia. Silahkan lakukan pembayaran.`,
            data: {
              type: "new_yearly_iuran",
              year: currentYear.toString(),
            },
          });
        }
        console.log(`Push notifications sent to all non-ADMIN users`);
      }
    } catch (error) {
      console.error("Error creating yearly iuran:", error);
    }
  });

  console.log("Yearly iuran generation scheduled: January 1st at 00:01 AM");

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
