import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import eventModel, { Event } from "../models/event.model";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import pengeluaranModel from "../models/pengeluaran.model";

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

      const result = await eventModel.create({
        name,
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

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      if (event.status === "completed") {
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

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      if (event.status === "completed") {
        response.error(
          res,
          "cannot delete completed event",
          "validation error"
        );
        return;
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
      const { donor_name, amount, date } = req.body;

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

      if (event.status === "completed") {
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
      const { description, amount, date } = req.body;
      const files = req.files as Express.Multer.File[] | undefined;

      if (!mongoose.isValidObjectId(id)) {
        response.error(res, "invalid event id", "validation error");
        return;
      }

      if (!description || !amount) {
        response.error(
          res,
          "description and amount are required",
          "validation error"
        );
        return;
      }

      const event = await eventModel.findById(id);
      if (!event) {
        return response.notFound(res, "event not found");
      }

      if (event.status === "completed") {
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
      for (const expense of event.expenses) {
        const pengeluaran = await pengeluaranModel.create({
          title: `${event.name} - ${expense.description}`,
          items: [
            {
              name: expense.description,
              price: Number(expense.amount),
              image_url: expense.proof_image_urls?.[0], // Use first image if available
            },
          ],
          total: Number(expense.amount),
          created_by: new Types.ObjectId(userId),
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
};
