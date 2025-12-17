import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import iuranModel, { Iuran } from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import userModel from "../models/user.model";
import notificationService from "../services/notification.service";

export default {
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const {
        limit = 10,
        page = 1,
        search,
        status,
        period,
        userId,
      } = req.query;

      // Build query
      let query: QueryFilter<Iuran> = {};

      // Filter by user (for Bendahara to see specific user's iuran)
      if (userId) {
        if (!mongoose.isValidObjectId(userId)) {
          response.error(res, "invalid user id", "validation error");
          return;
        }
        query.user = new Types.ObjectId(userId as string);
      }

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
  async recordPayment(req: IReqUser, res: Response): Promise<void> {
    try {
      const bendaharaId = req.user?.id;
      if (!bendaharaId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { userId, amount, periods, payment_date, payment_method, note } =
        req.body;

      if (
        !userId ||
        !amount ||
        !periods ||
        !Array.isArray(periods) ||
        periods.length === 0
      ) {
        response.error(
          res,
          "userId, amount, and periods array are required",
          "validation error"
        );
        return;
      }

      if (!mongoose.isValidObjectId(userId)) {
        response.error(res, "invalid user id", "validation error");
        return;
      }

      const user = await userModel.findById(userId);
      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      const now = new Date();
      const paymentDate = payment_date ? new Date(payment_date) : now;
      const updatedIuran = [];
      const errors = [];

      // Update each period
      for (const period of periods) {
        try {
          // Find unpaid iuran for this user and period
          const iuran = await iuranModel.findOne({
            user: new Types.ObjectId(userId),
            period: period,
            status: IURAN_STATUS.UNPAID,
          });

          if (!iuran) {
            errors.push(`Period ${period}: No unpaid iuran found`);
            continue;
          }

          // Update to paid
          const result = await iuranModel.findByIdAndUpdate(
            iuran._id,
            {
              status: IURAN_STATUS.PAID,
              amount: String(amount),
              payment_date: paymentDate,
              payment_method: payment_method || null,
              note: note || null,
              confirmed_at: now,
              confirmed_by: bendaharaId,
              recorded_by: bendaharaId,
            },
            { new: true }
          );

          updatedIuran.push(result);
        } catch (error: any) {
          errors.push(`Period ${period}: ${error.message}`);
        }
      }

      // Send notification to user
      if (updatedIuran.length > 0) {
        const periodsText = updatedIuran.map((i) => i?.period).join(", ");
        await notificationService.sendToUser(userId, {
          title: "Pembayaran berhasil dicatat! ✅",
          body: `Pembayaran Anda untuk periode ${periodsText} telah dicatat oleh Bendahara. Total: Rp ${Number(
            amount
          ).toLocaleString("id-ID")}`,
          data: {
            type: "payment_recorded",
            periods: periodsText,
            amount: String(amount),
          },
        });
      }

      return response.success(
        res,
        {
          success: updatedIuran.length,
          failed: errors.length,
          updatedIuran,
          errors: errors.length > 0 ? errors : null,
        },
        `Successfully recorded ${updatedIuran.length} payment(s)`
      );
    } catch (error) {
      response.error(res, error, "failed to record payment");
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
};
