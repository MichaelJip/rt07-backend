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
      const result = await iuranModel.findByIdAndUpdate(id, updateData, {
        new: true,
      });

      if (!result) {
        response.notFound(res, "iuran not found");
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
        query.status = status as string;
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
  // TODO: Remove this method after testing/demo - manual trigger for monthly iuran generation
  async generateMonthlyIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      console.log("Manually creating monthly iuran for WARGA...");

      // Get current period (YYYY-MM format)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const period = `${year}-${month}`;

      // Find all WARGA users
      const wargaUsers = await userModel
        .find({
          role: ROLES.WARGA,
        })
        .select("_id username");

      console.log(`Found ${wargaUsers.length} warga users`);

      let createdCount = 0;
      let skippedCount = 0;

      // Create iuran for each warga
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
          createdCount++;
        } else {
          skippedCount++;
        }
      }

      console.log(
        `Monthly iuran generation complete. Created: ${createdCount}, Skipped (already exists): ${skippedCount}`
      );

      return response.success(
        res,
        {
          period,
          totalWarga: wargaUsers.length,
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
};
