import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import eventModel, { Event } from "../models/event.model";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import pengeluaranModel from "../models/pengeluaran.model";
import { generateEventReport } from "../utils/excelReportGenerator";
import { generateSlug, generateUniqueSlug } from "../utils/slugGenerator";
import { ROLES } from "../utils/constants";
import { getCurrentBalance } from "./keuangan.controller";

export default {
  async create(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { name, description, date } = req.body;

      if (!name || !description || !date) {
        response.error(
          res,
          "name, description, and date are required",
          "validation error"
        );
        return;
      }

      // Generate slug from name
      const baseSlug = generateSlug(name);

      // Check for existing slugs to ensure uniqueness
      const existingEvents = await eventModel.find({ slug: new RegExp(`^${baseSlug}`) }).select('slug').lean();
      const existingSlugs = existingEvents.map(e => e.slug);
      const slug = generateUniqueSlug(baseSlug, existingSlugs);

      const result = await eventModel.create({
        name,
        slug,
        description,
        date: new Date(date),
        donations: [],
        expenses: [],
        total_donations: "0",
        total_expenses: "0",
        balance: "0",
        status: "planning",
        created_by: userId,
      });

      return response.success(res, result, "success create event");
    } catch (error) {
      response.error(res, error, "failed to create event");
      return;
    }
  },

  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, status } = req.query;

      let query: QueryFilter<Event> = {};

      if (status) {
        query.status = status as string;
      }

      const result = await eventModel
        .find(query)
        .populate("created_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ date: -1 })
        .lean()
        .exec();

      const count = await eventModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all events"
      );
    } catch (error) {
      response.error(res, error, "failed to find all events");
      return;
    }
  },

  async findOne(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const result = await eventModel
        .findById(id)
        .populate("created_by", "username")
        .lean();

      if (!result) {
        return response.notFound(res, "event not found");
      }

      return response.success(res, result, "success find event");
    } catch (error) {
      response.error(res, error, "failed to find event");
      return;
    }
  },

  async update(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, description, date, status } = req.body;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      // ADMIN can bypass completed event restriction
      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(
          res,
          "cannot update completed event",
          "validation error"
        );
        return;
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (description) updateData.description = description;
      if (date) updateData.date = new Date(date);
      if (status) updateData.status = status;

      const result = await eventModel
        .findByIdAndUpdate(id, updateData, { new: true })
        .populate("created_by", "username");

      return response.success(res, result, "success update event");
    } catch (error) {
      response.error(res, error, "failed to update event");
      return;
    }
  },

  async delete(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      // ADMIN can bypass completed event restriction
      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(
          res,
          "cannot delete completed event",
          "validation error"
        );
        return;
      }

      // Delete related pengeluaran records if event was completed
      if (event.status === "completed") {
        await pengeluaranModel.deleteMany({ event_id: id });
      }

      await eventModel.findByIdAndDelete(id);

      return response.success(res, null, "success delete event");
    } catch (error) {
      response.error(res, error, "failed to delete event");
      return;
    }
  },

  async addDonation(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { donor_name, amount, date, address } = req.body;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      if (!donor_name || !amount) {
        response.error(
          res,
          "donor_name and amount are required",
          "validation error"
        );
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      // ADMIN can bypass completed event restriction
      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(
          res,
          "cannot add donation to completed event",
          "validation error"
        );
        return;
      }

      event.donations.push({
        donor_name,
        amount: String(amount),
        date: date ? new Date(date) : new Date(),
        address: address || null,
      });

      // Auto-set status to active when first donation is added
      if (event.status === "planning") {
        event.status = "active";
      }

      await event.save(); // Will trigger pre-save hook to recalculate totals

      return response.success(res, event, "success add donation");
    } catch (error) {
      response.error(res, error, "failed to add donation");
      return;
    }
  },

  async addExpense(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { description, amount, date, category } = req.body;
      const files = req.files as Express.Multer.File[] | undefined;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      if (!description || !amount || !category) {
        response.error(
          res,
          "description, amount, and category are required",
          "validation error"
        );
        return;
      }

      const validCategories = ["HIBURAN", "LOMBA", "KONSUMSI", "LAINNYA"];
      if (!validCategories.includes(category)) {
        response.error(
          res,
          "category must be one of: HIBURAN, LOMBA, KONSUMSI, LAINNYA",
          "validation error"
        );
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      // ADMIN can bypass completed event restriction
      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(
          res,
          "cannot add expense to completed event",
          "validation error"
        );
        return;
      }

      const proof_image_urls = files
        ? files.map((file) => `/uploads/${file.filename}`)
        : [];

      event.expenses.push({
        description,
        amount: String(amount),
        date: date ? new Date(date) : new Date(),
        category,
        proof_image_urls,
      });

      // Auto-set status to active when first expense is added
      if (event.status === "planning") {
        event.status = "active";
      }

      await event.save(); // Will trigger pre-save hook to recalculate totals

      return response.success(res, event, "success add expense");
    } catch (error) {
      response.error(res, error, "failed to add expense");
      return;
    }
  },

  async completeEvent(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      if (event.status === "completed") {
        response.error(res, "event already completed", "validation error");
        return;
      }

      // Create individual pengeluaran records for EACH expense in the event
      // This makes ALL expenses transparent in the public pengeluaran list
      const createdPengeluaran = [];

      // Get existing slugs to ensure uniqueness
      const existingPengeluaran = await pengeluaranModel.find({}, { slug: 1 }).lean();
      const existingSlugs = existingPengeluaran.map((p) => p.slug);

      for (const expense of event.expenses) {
        const title = `${event.name} - ${expense.description}`;
        const baseSlug = generateSlug(title);
        const slug = generateUniqueSlug(baseSlug, existingSlugs);
        existingSlugs.push(slug); // Track newly created slugs

        const pengeluaran = await pengeluaranModel.create({
          title,
          slug,
          items: [
            {
              name: expense.description,
              price: Number(expense.amount),
              image_url: expense.proof_image_urls?.[0], // Use first image if available
            },
          ],
          total: Number(expense.amount),
          created_by: new Types.ObjectId(userId),
          event_id: event._id, // Link pengeluaran to event
        });
        createdPengeluaran.push(pengeluaran);
      }

      // Calculate balance
      const balance = Number(event.balance);
      const donations = Number(event.total_donations);
      const expenses = Number(event.total_expenses);

      // Mark event as completed
      event.status = "completed";
      event.completed_at = new Date();
      await event.save();

      return response.success(
        res,
        {
          event,
          balance: balance,
          total_donations: donations,
          total_expenses: expenses,
          pengeluaran_created: createdPengeluaran.length,
          summary:
            balance < 0
              ? `Event had deficit of Rp ${Math.abs(balance).toLocaleString(
                  "id-ID"
                )}. Donations (Rp ${donations.toLocaleString(
                  "id-ID"
                )}) covered Rp ${donations.toLocaleString(
                  "id-ID"
                )} of expenses. Remaining Rp ${Math.abs(balance).toLocaleString(
                  "id-ID"
                )} taken from main balance.`
              : balance > 0
              ? `Event had surplus of Rp ${balance.toLocaleString(
                  "id-ID"
                )}. This surplus will be added to main balance.`
              : "Event is balanced - donations exactly covered all expenses.",
        },
        "event completed successfully"
      );
    } catch (error) {
      response.error(res, error, "failed to complete event");
      return;
    }
  },

  async findBySlug(req: IReqUser, res: Response): Promise<void> {
    try {
      const { slug } = req.params;

      const result = await eventModel
        .findOne({ slug, status: "completed" })
        .select("-created_by -expenses.proof_image_urls")
        .lean();

      if (!result) {
        return response.notFound(res, "event not found or not yet completed");
      }

      return response.success(res, result, "success find event");
    } catch (error) {
      response.error(res, error, "failed to find event");
      return;
    }
  },

  async downloadEventReport(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id).lean();
      if (!event) {
        response.notFound(res, "event not found");
        return;
      }

      if (event.status !== "completed") {
        response.error(
          res,
          "can only download report for completed events",
          "validation error"
        );
        return;
      }

      const totalSumbangan = Number(event.total_donations);
      const buffer = await generateEventReport(event as Event, totalSumbangan);

      // Set headers for Excel file download
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Laporan_${event.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx"`
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      response.error(res, error, "failed to download event report");
      return;
    }
  },

  async updateDonation(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, donationId } = req.params;
      const { donor_name, amount, date, address } = req.body;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(donationId)) {
        response.error(res, "invalid id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) return response.notFound(res, "event not found");

      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(res, "cannot update donation in completed event", "validation error");
        return;
      }

      const donation = (event.donations as any).id(donationId);
      if (!donation) return response.notFound(res, "donation not found");

      if (donor_name !== undefined) donation.donor_name = donor_name;
      if (amount !== undefined) donation.amount = String(amount);
      if (date !== undefined) donation.date = new Date(date);
      if (address !== undefined) donation.address = address;

      await event.save();
      return response.success(res, event, "success update donation");
    } catch (error) {
      response.error(res, error, "failed to update donation");
    }
  },

  async deleteDonation(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, donationId } = req.params;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(donationId)) {
        response.error(res, "invalid id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) return response.notFound(res, "event not found");

      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(res, "cannot delete donation in completed event", "validation error");
        return;
      }

      const donation = (event.donations as any).id(donationId);
      if (!donation) return response.notFound(res, "donation not found");

      donation.deleteOne();
      await event.save();
      return response.success(res, event, "success delete donation");
    } catch (error) {
      response.error(res, error, "failed to delete donation");
    }
  },

  async updateExpense(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, expenseId } = req.params;
      const { description, amount, date, category } = req.body;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(expenseId)) {
        response.error(res, "invalid id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) return response.notFound(res, "event not found");

      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(res, "cannot update expense in completed event", "validation error");
        return;
      }

      const expense = (event.expenses as any).id(expenseId);
      if (!expense) return response.notFound(res, "expense not found");

      const oldAmount = Number(expense.amount);
      const newAmount = amount !== undefined ? Number(amount) : oldAmount;

      // If event is completed, the expense has a linked pengeluaran - check kas
      if (event.status === "completed" && newAmount !== oldAmount) {
        const difference = newAmount - oldAmount;
        if (difference > 0) {
          const currentBalance = await getCurrentBalance();
          if (difference > currentBalance) {
            response.error(
              res,
              {
                message: "Update expense melebihi saldo kas yang tersedia",
                current_balance: currentBalance,
                old_amount: oldAmount,
                new_amount: newAmount,
                additional_required: difference,
              },
              "insufficient balance"
            );
            return;
          }
        }

        // Update linked pengeluaran record
        const linkedPengeluaran = await pengeluaranModel.findOne({ event_id: id });
        if (linkedPengeluaran) {
          // Find the matching item by name
          const itemIndex = linkedPengeluaran.items.findIndex(
            (item: any) => item.name === expense.description
          );
          if (itemIndex >= 0) {
            linkedPengeluaran.items[itemIndex].price = newAmount;
            linkedPengeluaran.total = linkedPengeluaran.items.reduce(
              (sum: number, item: any) => sum + item.price,
              0
            );
            await linkedPengeluaran.save();
          }
        }
      }

      if (description !== undefined) expense.description = description;
      if (amount !== undefined) expense.amount = String(newAmount);
      if (date !== undefined) expense.date = new Date(date);
      if (category !== undefined) expense.category = category;

      await event.save();
      return response.success(res, event, "success update expense");
    } catch (error) {
      response.error(res, error, "failed to update expense");
    }
  },

  async deleteExpense(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, expenseId } = req.params;
      const userRole = req.user?.role;

      if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(expenseId)) {
        response.error(res, "invalid id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) return response.notFound(res, "event not found");

      if (event.status === "completed" && userRole !== ROLES.ADMIN) {
        response.error(res, "cannot delete expense in completed event", "validation error");
        return;
      }

      const expense = (event.expenses as any).id(expenseId);
      if (!expense) return response.notFound(res, "expense not found");

      // If event is completed, update linked pengeluaran (reduce total)
      if (event.status === "completed") {
        const linkedPengeluaran = await pengeluaranModel.findOne({ event_id: id });
        if (linkedPengeluaran) {
          const itemIndex = linkedPengeluaran.items.findIndex(
            (item: any) => item.name === expense.description
          );
          if (itemIndex >= 0) {
            linkedPengeluaran.items.splice(itemIndex, 1);
            linkedPengeluaran.total = linkedPengeluaran.items.reduce(
              (sum: number, item: any) => sum + item.price,
              0
            );
            if (linkedPengeluaran.items.length === 0) {
              await pengeluaranModel.findByIdAndDelete(linkedPengeluaran._id);
            } else {
              await linkedPengeluaran.save();
            }
          }
        }
      }

      expense.deleteOne();
      await event.save();
      return response.success(res, event, "success delete expense");
    } catch (error) {
      response.error(res, error, "failed to delete expense");
    }
  },
};
