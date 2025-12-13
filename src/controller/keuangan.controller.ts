import { Response } from "express";
import mongoose from "mongoose";
import iuranModel from "../models/iuran.model";
import pengeluaranModel from "../models/pengeluaran.model";
import { IURAN_STATUS } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";

async function getCurrentBalance(): Promise<number> {
  const totalIncomeResult = await iuranModel.aggregate([
    {
      $match: {
        status: IURAN_STATUS.PAID,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const totalIncome =
    totalIncomeResult.length > 0 ? totalIncomeResult[0].total : 0;

  const totalExpenseResult = await pengeluaranModel.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$total" },
      },
    },
  ]);

  const totalExpense =
    totalExpenseResult.length > 0 ? totalExpenseResult[0].total : 0;

  return totalIncome - totalExpense;
}

export default {
  async getLaporanKeuangan(req: IReqUser, res: Response): Promise<void> {
    try {
      const balance = await getCurrentBalance();

      const totalIncomeResult = await iuranModel.aggregate([
        {
          $match: {
            status: IURAN_STATUS.PAID,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: "$amount" } },
          },
        },
      ]);

      const totalIncome =
        totalIncomeResult.length > 0 ? totalIncomeResult[0].total : 0;

      const totalExpenseResult = await pengeluaranModel.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: "$total" },
          },
        },
      ]);

      const totalExpense =
        totalExpenseResult.length > 0 ? totalExpenseResult[0].total : 0;

      return response.success(
        res,
        {
          total_income: totalIncome,
          total_expense: totalExpense,
          balance: balance,
        },
        "success get laporan keuangan"
      );
    } catch (error) {
      response.error(res, error, "failed to get laporan keuangan");
      return;
    }
  },

  async createPengeluaran(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { title, total } = req.body;
      const files = req.files as Express.Multer.File[];

      if (!title || !total) {
        response.error(
          res,
          "title and total are required",
          "validation error"
        );
        return;
      }

      // Check if items are already parsed as array (from form-data)
      let items = [];
      if (Array.isArray(req.body.items)) {
        // Items are already parsed as array
        items = req.body.items.map((item: any, index: number) => {
          if (!item.name || item.price === undefined || item.price === null) {
            throw new Error(`Item ${index} must have name and price`);
          }

          const itemData: any = {
            name: item.name,
            price: Number(item.price),
          };

          // Find matching file for this item
          const matchingFile = files?.find(
            (file) => file.fieldname === `items[${index}][image]`
          );
          if (matchingFile) {
            itemData.image_url = `/uploads/${matchingFile.filename}`;
          }

          return itemData;
        });
      } else {
        // Fallback: try to parse items from individual fields
        let itemIndex = 0;
        while (req.body[`items[${itemIndex}][name]`]) {
          const name = req.body[`items[${itemIndex}][name]`];
          const price = req.body[`items[${itemIndex}][price]`];

          if (!name || price === undefined || price === null) {
            response.error(
              res,
              `Item ${itemIndex} must have name and price`,
              "validation error"
            );
            return;
          }

          const item: any = {
            name,
            price: Number(price),
          };

          const imageFieldName = `items[${itemIndex}][image]`;
          const matchingFile = files?.find(
            (file) => file.fieldname === imageFieldName
          );
          if (matchingFile) {
            item.image_url = `/uploads/${matchingFile.filename}`;
          }

          items.push(item);
          itemIndex++;
        }
      }

      if (items.length === 0) {
        response.error(
          res,
          "at least one item is required",
          "validation error"
        );
        return;
      }

      const currentBalance = await getCurrentBalance();
      const expenseAmount = Number(total);

      if (expenseAmount > currentBalance) {
        response.error(
          res,
          {
            message: "Expense amount exceeds current balance",
            current_balance: currentBalance,
            requested_amount: expenseAmount,
            difference: expenseAmount - currentBalance,
          },
          "insufficient balance"
        );
        return;
      }

      const result = await pengeluaranModel.create({
        title,
        items,
        total: expenseAmount,
        created_by: userId,
      });

      return response.success(res, result, "success create pengeluaran");
    } catch (error) {
      response.error(res, error, "failed to create pengeluaran");
      return;
    }
  },

  async getAllPengeluaran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, search } = req.query;

      let query: any = {};

      if (search) {
        query.title = { $regex: search as string, $options: "i" };
      }

      const result = await pengeluaranModel
        .find(query)
        .populate("created_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ created_at: -1 })
        .lean()
        .exec();

      const count = await pengeluaranModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success get all pengeluaran"
      );
    } catch (error) {
      response.error(res, error, "failed to get all pengeluaran");
      return;
    }
  },

  async getPengeluaranById(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid pengeluaran id", "validation error");
        return;
      }

      const result = await pengeluaranModel
        .findById(id)
        .populate("created_by", "username")
        .lean();

      if (!result) {
        return response.notFound(res, "pengeluaran not found");
      }

      return response.success(res, result, "success get pengeluaran");
    } catch (error) {
      response.error(res, error, "failed to get pengeluaran");
      return;
    }
  },

  async deletePengeluaran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid pengeluaran id", "validation error");
        return;
      }

      const result = await pengeluaranModel.findByIdAndDelete(id);

      if (!result) {
        return response.notFound(res, "pengeluaran not found");
      }

      return response.success(
        res,
        result,
        "success delete pengeluaran"
      );
    } catch (error) {
      response.error(res, error, "failed to delete pengeluaran");
      return;
    }
  },

  async updatePengeluaran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { title, total } = req.body;
      const files = req.files as Express.Multer.File[];

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid pengeluaran id", "validation error");
        return;
      }

      const existingPengeluaran = await pengeluaranModel.findById(id);
      if (!existingPengeluaran) {
        return response.notFound(res, "pengeluaran not found");
      }

      const updateData: any = {};
      if (title) updateData.title = title;

      // Handle items similar to createPengeluaran
      if (req.body.items) {
        let items = [];
        if (Array.isArray(req.body.items)) {
          // Items are already parsed as array
          items = req.body.items.map((item: any, index: number) => {
            if (!item.name || item.price === undefined || item.price === null) {
              throw new Error(`Item ${index} must have name and price`);
            }

            const itemData: any = {
              name: item.name,
              price: Number(item.price),
            };

            // Keep existing image_url if present
            if (item.image_url) {
              itemData.image_url = item.image_url;
            }

            // Find matching file for this item (new upload)
            const matchingFile = files?.find(
              (file) => file.fieldname === `items[${index}][image]`
            );
            if (matchingFile) {
              itemData.image_url = `/uploads/${matchingFile.filename}`;
            }

            return itemData;
          });
        }

        if (items.length === 0) {
          response.error(
            res,
            "items must be a non-empty array",
            "validation error"
          );
          return;
        }
        updateData.items = items;
      }

      if (total !== undefined) updateData.total = Number(total);

      if (total !== undefined) {
        const newTotal = Number(total);
        const oldTotal = existingPengeluaran.total;
        const difference = newTotal - oldTotal;

        if (difference > 0) {
          const currentBalance = await getCurrentBalance();

          if (difference > currentBalance) {
            response.error(
              res,
              {
                message: "Updated expense amount exceeds current balance",
                current_balance: currentBalance,
                old_total: oldTotal,
                new_total: newTotal,
                additional_required: difference,
              },
              "insufficient balance"
            );
            return;
          }
        }
      }

      const result = await pengeluaranModel
        .findByIdAndUpdate(id, updateData, { new: true })
        .populate("created_by", "username");

      if (!result) {
        return response.notFound(res, "pengeluaran not found");
      }

      return response.success(res, result, "success update pengeluaran");
    } catch (error) {
      response.error(res, error, "failed to update pengeluaran");
      return;
    }
  },
};
