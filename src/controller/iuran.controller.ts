import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import iuranModel, { Iuran } from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import { IuranSubmitWargaDTO } from "../utils/zodSchema";
import path from "path";
import fs from "fs";
import userModel from "../models/user.model";
import notificationService from "../utils/notification.service";

export default {
  async create(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { period, amount } = req.body;

      const parsed = IuranSubmitWargaDTO.safeParse({
        period,
        amount,
      });

      if (!parsed.success) {
        response.error(res, parsed.error, "validation error");
        return;
      }
      const data = parsed.data;

      const result = await iuranModel.create({
        user: userId,
        period: data.period,
        amount: data.amount,
        status: IURAN_STATUS.PENDING,
        submitted_at: new Date(),
        confirmed_at: null,
        confirmed_by: null,
      });
      return response.success(res, result, "success create iuran");
    } catch (error) {
      response.error(res, error, "failed to create iuran");
      return;
    }
  },
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, search, status, period } = req.query;

      // Build query
      let query: QueryFilter<Iuran> = {};

      // Filter by period (exact match)
      if (period) {
        query.period = period as string;
      }

      // Filter by status (single or multiple comma-separated values)
      if (status) {
        const statusArray = (status as string).split(",").map((s) => s.trim());
        if (statusArray.length === 1) {
          query.status = statusArray[0];
        } else {
          query.status = { $in: statusArray };
        }
      }

      // Search by period (if no exact period filter)
      if (search && !period) {
        query.period = { $regex: search as string, $options: "i" };
      }

      const result = await iuranModel
        .find(query)
        .populate("user", "username")
        .populate("confirmed_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ created_at: -1 })
        .lean()
        .exec();

      const count = await iuranModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all iuran"
      );
    } catch (error) {
      response.error(res, error, "failed to find all iuran");
      return;
    }
  },
  async findOne(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid iuran id", "validate error");
        return;
      }

      const result = await iuranModel
        .findById(id)
        .populate("confirmed_by", "username")
        .lean();

      if (!result) {
        return response.notFound(res, "failed to find iuran");
      }

      return response.success(res, result, "success to find iuran");
    } catch (error) {
      response.error(res, error, "failed to find iuran");
      return;
    }
  },
  async submitPayment(req: IReqUser, res: Response): Promise<void> {
    try {
      const wargaId = req.user?.id;
      if (!wargaId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { id } = req.params; // iuran ID
      const file = req.file;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid iuran id", "validation error");
        return;
      }

      if (!file) {
        response.error(res, "Proof image is required", "validation error");
        return;
      }

      // Find the iuran
      const iuran = await iuranModel.findById(id);

      if (!iuran) {
        response.notFound(res, "iuran not found");
        return;
      }

      // Check if this iuran belongs to the warga
      if (!iuran.user.equals(new Types.ObjectId(wargaId))) {
        response.unauthorized(res, "you can only submit your own payment");
        return;
      }

      // Check if already paid or pending
      if (iuran.status === IURAN_STATUS.PAID) {
        response.error(res, "iuran already paid", "validation error");
        return;
      }

      if (iuran.status === IURAN_STATUS.PENDING) {
        response.error(
          res,
          "iuran already submitted, waiting for confirmation",
          "validation error"
        );
        return;
      }

      if (iuran.proof_image_url) {
        const oldImagePath = path.join(
          __dirname,
          "../../",
          iuran.proof_image_url
        );
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      // Update with proof image
      const image_url = `/uploads/${file.filename}`;

      const result = await iuranModel.findByIdAndUpdate(
        id,
        {
          proof_image_url: image_url,
          status: IURAN_STATUS.PENDING,
          submitted_at: new Date(),
        },
        { new: true }
      );

      return response.success(
        res,
        result,
        "payment proof submitted successfully"
      );
    } catch (error) {
      response.error(res, error, "failed to submit payment");
      return;
    }
  },
  async updateStatus(req: IReqUser, res: Response): Promise<void> {
    try {
      const bendaharaId = req.user?.id;
      if (!bendaharaId) {
        response.unauthorized(res, "unauthorized");
        return;
      }
      const { id } = req.params;
      const { status, note } = req.body as {
        status?: IURAN_STATUS;
        note?: string;
      };

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid iuran id", "validation error");
        return;
      }

      if (
        !status ||
        ![IURAN_STATUS.PAID, IURAN_STATUS.REJECTED].includes(status)
      ) {
        response.error(
          res,
          "status must be 'paid' or 'rejected'",
          "validation error"
        );
        return;
      }

      const now = new Date();

      const updateData: any = {
        status,
        confirmed_at: now,
        confirmed_by: bendaharaId,
      };
      if (note) {
        updateData.note = note;
      }
      const result = await iuranModel
        .findByIdAndUpdate(id, updateData, {
          new: true,
        })
        .populate("user", "username");

      if (!result) {
        response.notFound(res, "iuran not found");
        return;
      }

      // Send push notification to the user
      if (status === IURAN_STATUS.PAID) {
        await notificationService.sendToUser(result.user._id, {
          title: "Pembayaran berhasil! ✅",
          body: `Pembayaran anda untuk periode ${result.period} sudah dikonfirmasi.`,
          data: {
            type: "iuran_status_update",
            iuranId: result._id.toString(),
            status: IURAN_STATUS.PAID,
            period: result.period,
          },
        });
      } else if (status === IURAN_STATUS.REJECTED) {
        await notificationService.sendToUser(result.user._id, {
          title: "Pembayaran gagal ❌",
          body: note
            ? `Pembayaran anda untuk periode ${result.period} ditolak. Karena: ${note}`
            : `Pembayaran anda untuk periode ${result.period} ditolak. tolong untuk coba kembali.`,
          data: {
            type: "iuran_status_update",
            iuranId: result._id.toString(),
            status: IURAN_STATUS.REJECTED,
            period: result.period,
            note: note || "",
          },
        });
      }

      return response.success(res, result, "success to update iuran");
    } catch (error) {
      response.error(res, error, "failed to update iuran");
      return;
    }
  },
  async getMyHistory(req: IReqUser, res: Response): Promise<void> {
    try {
      const wargaId = req.user?.id;
      if (!wargaId) {
        response.unauthorized(res, "unauthorized");
        return;
      }
      const { limit = 10, page = 1, status, period, year } = req.query;

      let query: QueryFilter<Iuran> = { user: new Types.ObjectId(wargaId) };

      if (period) {
        query.period = period as string;
      } else if (year) {
        query.period = { $regex: `^${year}`, $options: "i" };
      }

      if (status) {
        const statusArray = (status as string).split(",").map((s) => s.trim());
        if (statusArray.length === 1) {
          query.status = statusArray[0];
        } else {
          query.status = { $in: statusArray };
        }
      }

      const result = await iuranModel
        .find(query)
        .populate("user", "username")
        .populate("confirmed_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ period: -1 })
        .lean()
        .exec();

      const count = await iuranModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success get payment history"
      );
    } catch (error) {
      response.error(res, error, "failed to get history");
      return;
    }
  },
  async getHistoryByPeriod(req: IReqUser, res: Response): Promise<void> {
    try {
      const { period } = req.params;
      const { limit = 10, page = 1, status } = req.params;

      if (!period) {
        response.error(res, "period is required", "validation error");
        return;
      }

      let query: QueryFilter<Iuran> = { period };

      if (status) {
        query.status = status as string;
      }

      const result = await iuranModel
        .find(query)
        .populate("user", "username email")
        .populate("confirmed_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ created_at: -1 })
        .lean()
        .exec();

      const count = await iuranModel.countDocuments(query);

      // Summary statistics for the period
      const summary = await iuranModel.aggregate([
        { $match: { period } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: "$amount" } },
          },
        },
      ]);

      res.status(200).json({
        meta: {
          status: 200,
          message: "success get period history",
        },
        data: {
          payments: result,
          summary,
        },
        pagination: {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
      });
    } catch (error) {
      response.error(res, error, "failed to get period history");
      return;
    }
  },
  async getStatusSummary(req: IReqUser, res: Response): Promise<void> {
    try {
      const { period } = req.params;

      if (!period) {
        response.error(res, "period is required", "validation error");
        return;
      }

      const statusCounts = await iuranModel.aggregate([
        { $match: { period } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const summary = {
        paid: 0,
        pending: 0,
        rejected: 0,
        unpaid: 0,
      };

      statusCounts.forEach((item) => {
        if (item._id in summary) {
          summary[item._id as keyof typeof summary] = item.count;
        }
      });

      return response.success(res, summary, "success get status summary");
    } catch (error) {
      response.error(res, error, "failed to get status summary");
      return;
    }
  },
  // Generate monthly iuran for all users except ADMIN
  async generateMonthlyIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      console.log("Creating monthly iuran for all users except ADMIN...");

      // Get current period (YYYY-MM format)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const period = `${year}-${month}`;

      // Find all users EXCEPT ADMIN
      const users = await userModel
        .find({
          role: { $ne: ROLES.ADMIN },
        })
        .select("_id username role");

      console.log(`Found ${users.length} users (excluding ADMIN)`);

      let createdCount = 0;
      let skippedCount = 0;

      // Create iuran for each user
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
        } else {
          skippedCount++;
        }
      }

      console.log(
        `Monthly iuran generation complete. Created: ${createdCount}, Skipped (already exists): ${skippedCount}`
      );

      // Send notification to all non-ADMIN users about new iuran
      if (createdCount > 0) {
        // Send to each role except ADMIN
        const nonAdminRoles = [
          ROLES.RT,
          ROLES.RW,
          ROLES.BENDAHARA,
          ROLES.SATPAM,
          ROLES.WARGA,
        ];

        for (const role of nonAdminRoles) {
          await notificationService.sendToRole(role, {
            title: "New Monthly Payment Due 📋",
            body: `Your monthly iuran for ${period} is now available. Please submit your payment.`,
            data: {
              type: "new_iuran",
              period: period,
            },
          });
        }
      }

      return response.success(
        res,
        {
          period,
          totalUsers: users.length,
          created: createdCount,
          skipped: skippedCount,
        },
        "Monthly iuran generated successfully"
      );
    } catch (error) {
      console.error("Error generating monthly iuran:", error);
      response.error(res, error, "failed to generate monthly iuran");
      return;
    }
  },
  // Generate custom period iuran (e.g., for special events like "17 Agustus")
  async generateCustomPeriodIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { period, amount, description } = req.body;

      // Validate required fields
      if (!period || !amount || !description) {
        response.error(
          res,
          "period, amount, and description are required",
          "validation error"
        );
        return;
      }

      // Validate amount is a valid number
      if (isNaN(Number(amount)) || Number(amount) <= 0) {
        response.error(res, "amount must be a positive number", "validation error");
        return;
      }

      // Validate period format (YYYY-MM)
      const periodRegex = /^\d{4}-\d{2}$/;
      if (!periodRegex.test(period)) {
        response.error(
          res,
          "period must be in YYYY-MM format (e.g., 2025-12)",
          "validation error"
        );
        return;
      }

      console.log(
        `Creating custom iuran for period: ${period} with amount: ${amount}, description: ${description}`
      );

      // Find all users EXCEPT ADMIN
      const users = await userModel
        .find({
          role: { $ne: ROLES.ADMIN },
        })
        .select("_id username role");

      console.log(`Found ${users.length} users (excluding ADMIN)`);

      let createdCount = 0;
      const errors: string[] = [];

      // Create iuran for each user (no skip check - users can have multiple custom iuran)
      for (const user of users) {
        try {
          await iuranModel.create({
            user: user._id,
            period: period,
            amount: String(amount),
            type: "custom",
            status: IURAN_STATUS.UNPAID,
            note: description,
            submitted_at: null,
            confirmed_at: null,
            confirmed_by: null,
          });
          createdCount++;
        } catch (error: any) {
          errors.push(`User ${user.username}: ${error.message}`);
        }
      }

      console.log(
        `Custom iuran generation complete. Created: ${createdCount}`
      );

      // Send notification to all non-ADMIN users about new custom iuran
      if (createdCount > 0) {
        const nonAdminRoles = [
          ROLES.RT,
          ROLES.RW,
          ROLES.BENDAHARA,
          ROLES.SATPAM,
          ROLES.WARGA,
        ];

        const notificationBody = `Iuran khusus untuk ${period} (${description}) sudah tersedia. Jumlah: Rp ${Number(amount).toLocaleString("id-ID")}. Silahkan lakukan pembayaran.`;

        for (const role of nonAdminRoles) {
          await notificationService.sendToRole(role, {
            title: "Iuran Khusus Baru 📋",
            body: notificationBody,
            data: {
              type: "custom_iuran",
              period: period,
              amount: String(amount),
              description: description,
            },
          });
        }
      }

      return response.success(
        res,
        {
          period,
          amount,
          description: description,
          totalUsers: users.length,
          created: createdCount,
          errors: errors.length > 0 ? errors : null,
        },
        "Custom period iuran generated successfully"
      );
    } catch (error) {
      console.error("Error generating custom period iuran:", error);
      response.error(res, error, "failed to generate custom period iuran");
      return;
    }
  },
};
