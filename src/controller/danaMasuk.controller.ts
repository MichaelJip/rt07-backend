import { Response } from "express";
import mongoose from "mongoose";
import danaMasukModel from "../models/danaMasuk.model";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";

export default {
  // Public: list all dana masuk
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1 } = req.query;

      const [results, count] = await Promise.all([
        danaMasukModel
          .find()
          .select("nama_pemberi nominal keterangan createdAt")
          .sort({ createdAt: -1 })
          .skip((+page - 1) * +limit)
          .limit(+limit)
          .lean(),
        danaMasukModel.countDocuments(),
      ]);

      return response.pagination(
        res,
        results,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success get dana masuk"
      );
    } catch (error) {
      response.error(res, error, "failed to get dana masuk");
    }
  },

  // Admin only: create dana masuk
  async create(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { nama_pemberi, nominal, keterangan } = req.body;

      if (!nama_pemberi || nominal === undefined || nominal === null) {
        response.error(res, "nama_pemberi and nominal are required", "validation error");
        return;
      }

      const numNominal = Number(nominal);
      if (isNaN(numNominal) || numNominal <= 0) {
        response.error(res, "nominal must be a positive number", "validation error");
        return;
      }

      const result = await danaMasukModel.create({
        nama_pemberi,
        nominal: numNominal,
        keterangan: keterangan || null,
        created_by: userId,
      });

      return response.success(res, result, "success create dana masuk");
    } catch (error) {
      response.error(res, error, "failed to create dana masuk");
    }
  },

  // Admin only: delete dana masuk
  async delete(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid id", "validation error");
        return;
      }

      const result = await danaMasukModel.findByIdAndDelete(id);
      if (!result) {
        response.notFound(res, "dana masuk not found");
        return;
      }

      return response.success(res, result, "success delete dana masuk");
    } catch (error) {
      response.error(res, error, "failed to delete dana masuk");
    }
  },
};
