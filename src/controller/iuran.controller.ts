import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import iuranModel, { Iuran } from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import userModel from "../models/user.model";
import { generateReceiptPDF } from "../utils/pdfGenerator";

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

      // Validate amount
      const totalAmount = Number(amount);
      const REQUIRED_AMOUNT_PER_PERIOD = 50000;
      const expectedTotalAmount = REQUIRED_AMOUNT_PER_PERIOD * periods.length;

      if (isNaN(totalAmount) || totalAmount <= 0) {
        response.error(res, "invalid amount", "validation error");
        return;
      }

      // Check if amount matches exactly (50k per period)
      if (totalAmount !== expectedTotalAmount) {
        response.error(
          res,
          `invalid amount. For ${
            periods.length
          } period(s), you must pay exactly Rp ${expectedTotalAmount.toLocaleString(
            "id-ID"
          )} (Rp ${REQUIRED_AMOUNT_PER_PERIOD.toLocaleString(
            "id-ID"
          )} per period). You provided Rp ${totalAmount.toLocaleString(
            "id-ID"
          )}`,
          "validation error"
        );
        return;
      }

      // Calculate amount per period
      const amountPerPeriod = REQUIRED_AMOUNT_PER_PERIOD;

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
              amount: String(amountPerPeriod),
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
  async generateReceipt(req: IReqUser, res: Response): Promise<void> {
    try {
      const { ids } = req.query;

      if (!ids || typeof ids !== "string") {
        response.error(
          res,
          "ids parameter is required (comma-separated iuran IDs)",
          "validation error"
        );
        return;
      }

      // Parse comma-separated IDs
      const iuranIds = ids.split(",").map((id) => id.trim());

      if (iuranIds.length === 0) {
        response.error(
          res,
          "at least one iuran ID is required",
          "validation error"
        );
        return;
      }

      // Validate all IDs
      for (const id of iuranIds) {
        if (!mongoose.isValidObjectId(id)) {
          response.error(res, `invalid iuran ID: ${id}`, "validation error");
          return;
        }
      }

      // Fetch iuran records
      const iuranRecords = await iuranModel
        .find({
          _id: { $in: iuranIds },
          status: IURAN_STATUS.PAID,
        })
        .populate("user", "username email")
        .populate("recorded_by", "username")
        .lean();

      if (iuranRecords.length === 0) {
        response.notFound(
          res,
          "no paid iuran records found with the provided IDs"
        );
        return;
      }

      // Validate all iuran belong to the same user
      const userIds = new Set(
        iuranRecords.map((iuran: any) => iuran.user._id.toString())
      );
      if (userIds.size > 1) {
        response.error(
          res,
          "all iuran records must belong to the same user",
          "validation error"
        );
        return;
      }

      // Calculate totals
      const totalAmount = iuranRecords.reduce(
        (sum, iuran: any) => sum + Number(iuran.amount),
        0
      );
      const amountPerPeriod = Number(iuranRecords[0].amount);

      // Get user and recorder info
      const userInfo = iuranRecords[0].user as any;
      const recorderInfo = iuranRecords[0].recorded_by as any;

      // Prepare receipt data
      const receiptData = {
        receiptNumber: `RCP-${Date.now()}-${userInfo._id.toString().slice(-6)}`,
        receiptDate: new Date(),
        paymentDate: new Date(iuranRecords[0].payment_date || new Date()),
        user: {
          id: userInfo._id.toString(),
          username: userInfo.username,
          email: userInfo.email,
        },
        periods: iuranRecords.map((iuran: any) => iuran.period).sort(),
        amountPerPeriod: amountPerPeriod,
        totalPeriods: iuranRecords.length,
        totalAmount: totalAmount,
        paymentMethod: iuranRecords[0].payment_method || null,
        note: iuranRecords[0].note || null,
        recordedBy: {
          id: recorderInfo?._id?.toString() || "",
          username: recorderInfo?.username || "Unknown",
        },
      };

      const receiptPdfUrl = await generateReceiptPDF(receiptData);

      return response.success(
        res,
        {
          receiptPdfUrl: receiptPdfUrl,
          receipt: receiptData,
        },
        "Receipt generated successfully"
      );
    } catch (error) {
      console.error("Generate receipt error:", error);
      response.error(res, error, "failed to generate receipt");
      return;
    }
  },
  async createYearlyIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { year } = req.body;

      if (!year) {
        response.error(res, "year is required", "validation error");
        return;
      }

      const targetYear = Number(year);
      if (isNaN(targetYear) || targetYear < 2020 || targetYear > 2100) {
        response.error(
          res,
          "invalid year. Must be between 2020 and 2100",
          "validation error"
        );
        return;
      }

      // Get all users except ADMIN
      const users = await userModel.find({ role: { $ne: ROLES.ADMIN } });

      if (users.length === 0) {
        response.error(
          res,
          "no users found to create iuran",
          "validation error"
        );
        return;
      }

      let totalCreated = 0;
      let totalSkipped = 0;
      const userResults = [];

      // Create iuran for each user
      for (const user of users) {
        const iuranPromises = [];
        const createdPeriods = [];
        const skippedPeriods = [];

        for (let month = 1; month <= 12; month++) {
          const period = `${targetYear}-${String(month).padStart(2, "0")}`;

          const existingIuran = await iuranModel.findOne({
            user: user._id,
            period: period,
            type: "regular",
          });

          if (existingIuran) {
            skippedPeriods.push(period);
            totalSkipped++;
            continue;
          }

          iuranPromises.push(
            iuranModel.create({
              user: user._id,
              period: period,
              amount: "50000",
              type: "regular",
              status: IURAN_STATUS.UNPAID,
              submitted_at: null,
              confirmed_at: null,
              confirmed_by: null,
            })
          );
          createdPeriods.push(period);
          totalCreated++;
        }

        await Promise.all(iuranPromises);

        userResults.push({
          userId: user._id,
          username: user.username,
          created: createdPeriods.length,
          skipped: skippedPeriods.length,
        });
      }

      return response.success(
        res,
        {
          year: targetYear,
          totalUsers: users.length,
          totalCreated,
          totalSkipped,
          userResults,
        },
        `Successfully created ${totalCreated} iuran record(s) for ${users.length} user(s)`
      );
    } catch (error) {
      console.log(error, "check error");
      response.error(res, error, "failed to create yearly iuran");
      return;
    }
  },
};
