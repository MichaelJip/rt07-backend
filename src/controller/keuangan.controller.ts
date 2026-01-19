import { Response } from "express";
import fs from "fs";
import mongoose from "mongoose";
import path from "path";
import eventModel from "../models/event.model";
import iuranModel from "../models/iuran.model";
import pengeluaranModel from "../models/pengeluaran.model";
import { IURAN_STATUS } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import { generateSlug, generateUniqueSlug } from "../utils/slugGenerator";
import { getSettingValue, SETTINGS_KEYS } from "./settings.controller";

async function getCurrentBalance(): Promise<number> {
  // Get initial balance from settings (saldo awal periode)
  const initialBalance = await getSettingValue(SETTINGS_KEYS.INITIAL_BALANCE, 0);

  // Total income from paid iuran (exclude imported data - already counted in old balance)
  const totalIncomeResult = await iuranModel.aggregate([
    {
      $match: {
        status: IURAN_STATUS.PAID,
        is_imported: { $ne: true },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const totalIuranIncome =
    totalIncomeResult.length > 0 ? totalIncomeResult[0].total : 0;

  // Total donations from completed events
  const completedEvents = await eventModel.find({ status: "completed" }).lean();

  const totalEventDonations = completedEvents.reduce(
    (sum, event) => sum + Number(event.total_donations),
    0
  );

  // Total income = iuran + event donations
  const totalIncome = totalIuranIncome + totalEventDonations;

  // Total expenses
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

  // Balance = initial_balance + income - expense
  return initialBalance + totalIncome - totalExpense;
}

function deleteImageFile(imageUrl: string): void {
  try {
    // Extract filename from URL (e.g., "/uploads/filename.jpg" -> "filename.jpg")
    const filename = imageUrl.replace("/uploads/", "");
    const filePath = path.join(process.cwd(), "uploads", filename);

    // Check if file exists before deleting
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old image: ${filePath}`);
    }
  } catch (error) {
    console.error(`Failed to delete image ${imageUrl}:`, error);
    // Don't throw error - continue even if deletion fails
  }
}

export default {
  async getLaporanKeuangan(req: IReqUser, res: Response): Promise<void> {
    try {
      // Get initial balance from settings
      const initialBalance = await getSettingValue(SETTINGS_KEYS.INITIAL_BALANCE, 0);

      const balance = await getCurrentBalance();

      // Total income from iuran (exclude imported data)
      const totalIncomeResult = await iuranModel.aggregate([
        {
          $match: {
            status: IURAN_STATUS.PAID,
            is_imported: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: "$amount" } },
          },
        },
      ]);

      const totalIuranIncome =
        totalIncomeResult.length > 0 ? totalIncomeResult[0].total : 0;

      // Total expenses
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

      // Get completed events
      const completedEvents = await eventModel
        .find({ status: "completed" })
        .lean();

      let totalEventDonations = 0;
      let totalEventExpenses = 0;

      const eventSummaries = completedEvents.map((event) => {
        const donations = Number(event.total_donations);
        const expenses = Number(event.total_expenses);
        const balance = Number(event.balance);

        totalEventDonations += donations;
        totalEventExpenses += expenses;

        return {
          name: event.name,
          slug: event.slug,
          date: event.date,
          total_donations: donations,
          total_expenses: expenses,
          balance: balance,
          completed_at: event.completed_at,
        };
      });

      // Total income = iuran + ALL event donations (not just surplus)
      const totalIncome = totalIuranIncome + totalEventDonations;

      return response.success(
        res,
        {
          initial_balance: initialBalance,
          total_income: totalIncome,
          total_iuran_income: totalIuranIncome,
          total_event_donations: totalEventDonations,
          total_expense: totalExpense,
          balance: balance,
          events: eventSummaries,
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
        response.error(res, "title and total are required", "validation error");
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

      // Generate unique slug
      const baseSlug = generateSlug(title);
      const existingPengeluaran = await pengeluaranModel
        .find()
        .select("slug")
        .lean();
      const existingSlugs = existingPengeluaran.map((p: any) => p.slug);
      const slug = generateUniqueSlug(baseSlug, existingSlugs);

      const result = await pengeluaranModel.create({
        title,
        slug,
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

  async getPengeluaranBySlug(req: IReqUser, res: Response): Promise<void> {
    try {
      const { slug } = req.params;

      const result = await pengeluaranModel
        .findOne({ slug })
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

      // Delete all associated images
      if (result.items && Array.isArray(result.items)) {
        result.items.forEach((item: any) => {
          if (item.image_url) {
            deleteImageFile(item.image_url);
          }
        });
      }

      return response.success(res, result, "success delete pengeluaran");
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

      console.log("Existing pengeluaran items:", existingPengeluaran.items);

      const updateData: any = {};
      if (title) {
        updateData.title = title;

        // Generate new slug if title changed
        if (title !== existingPengeluaran.title) {
          const baseSlug = generateSlug(title);
          const existingPengeluaran = await pengeluaranModel
            .find({ _id: { $ne: id } })
            .select("slug")
            .lean();
          const existingSlugs = existingPengeluaran.map((p: any) => p.slug);
          updateData.slug = generateUniqueSlug(baseSlug, existingSlugs);
        }
      }

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

            // Priority for image_url:
            // 1. New file upload (highest priority)
            // 2. Existing image_url from request body (frontend sends it)
            // 3. Keep old image_url from database (if exists)

            // Find matching file for this item (new upload)
            const matchingFile = files?.find(
              (file) => file.fieldname === `items[${index}][image]`
            );

            if (matchingFile) {
              // New file uploaded - delete old image and use new one
              const oldImageUrl = existingPengeluaran.items[index]?.image_url;
              if (oldImageUrl) {
                deleteImageFile(oldImageUrl);
              }
              itemData.image_url = `/uploads/${matchingFile.filename}`;
            } else if (item.image_url) {
              // Frontend sent an image_url - keep it
              itemData.image_url = item.image_url;
            } else if (existingPengeluaran.items[index]?.image_url) {
              // No new file and no image_url in request - keep old one from database
              itemData.image_url = existingPengeluaran.items[index].image_url;
            }

            console.log(`Item ${index}:`, itemData);

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
