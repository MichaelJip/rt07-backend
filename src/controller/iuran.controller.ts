import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import iuranModel, { Iuran } from "../models/iuran.model";
import { IURAN_STATUS } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import { IuranSubmitWargaDTO } from "../utils/zodSchema";

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

      // Filter by status
      if (status) {
        query.status = status as string;
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
      const { status } = req.body as { status?: IURAN_STATUS; note?: string };

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

      const result = await iuranModel.findByIdAndUpdate(
        id,
        {
          status,
          confirmed_at: now,
          confirmed_by: bendaharaId,
        },
        {
          new: true,
        }
      );

      if (!result) {
        response.notFound(res, "iuran not found");
      }
      return response.success(res, result, "success to update iuran");
    } catch (error) {
      response.error(res, error, "failed to update iuran");
      return;
    }
  },
};
