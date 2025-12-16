import { Response, Request } from "express";
import { InventoryDTO, InventoryUpdateDTO } from "../utils/zodSchema";
import response from "../utils/response";
import inventoryModel, { Inventory } from "../models/inventory.model";
import { QueryFilter } from "mongoose";
import { IReqUser } from "../utils/interface";

export default {
  async create(req: Request, res: Response): Promise<void> {
    const { name, quantity } = req.body;
    const userId = (req as IReqUser).user?.id;

    console.log("Creating inventory - User ID:", userId);

    const parsed = InventoryDTO.safeParse({
      name,
      quantity,
    });

    if (!parsed.success) {
      response.error(res, parsed.error, "validation error");
      return;
    }

    const data = parsed.data;

    try {
      const existingName = await inventoryModel.findOne({
        name: data.name,
      });

      if (existingName) {
        response.conflict(res, "name is already taken");
        return;
      }

      const result = await inventoryModel.create({
        ...data,
        createdBy: userId,
      });
      response.success(res, result, "success add inventory");
      return;
    } catch (error) {
      console.log("Add Inventory Error:", error);
      response.error(res, error, "failed to add inventory");
      return;
    }
  },

  async detail(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    try {
      const result = await inventoryModel
        .findById(id)
        .populate("createdBy", "username email");

      if (!result) {
        response.notFound(res, "inventory not found");
        return;
      }

      response.success(res, result, "success get inventory detail");
      return;
    } catch (error) {
      console.log("Get Inventory Detail Error:", error);
      response.error(res, error, "failed to get inventory detail");
      return;
    }
  },

  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const { name, quantity } = req.body;

    const parsed = InventoryUpdateDTO.safeParse({
      name,
      quantity,
    });

    if (!parsed.success) {
      response.error(res, parsed.error, "validation error");
      return;
    }

    const data = parsed.data;

    if (Object.keys(data).length === 0) {
      response.error(res, null, "at least one field is required");
      return;
    }

    try {
      const existingInventory = await inventoryModel.findById(id);

      if (!existingInventory) {
        response.notFound(res, "inventory not found");
        return;
      }

      if (data.name) {
        const existingName = await inventoryModel.findOne({
          name: data.name,
          _id: { $ne: id },
        });

        if (existingName) {
          response.conflict(res, "name is already taken");
          return;
        }
      }

      const result = await inventoryModel.findByIdAndUpdate(id, data, {
        new: true,
      });

      response.success(res, result, "success update inventory");
      return;
    } catch (error) {
      console.log("Update Inventory Error:", error);
      response.error(res, error, "failed to update inventory");
      return;
    }
  },

  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;

    try {
      const result = await inventoryModel.findByIdAndDelete(id);

      if (!result) {
        response.notFound(res, "inventory not found");
        return;
      }

      response.success(res, result, "success delete inventory");
      return;
    } catch (error) {
      console.log("Delete Inventory Error:", error);
      response.error(res, error, "failed to delete inventory");
      return;
    }
  },

  async findAll(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, search } = req.query;

      let query: QueryFilter<Inventory> = {};

      if (search && typeof search === "string") {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = (+page - 1) * +limit;

      const [results, count] = await Promise.all([
        inventoryModel
          .find(query)
          .skip(skip)
          .limit(+limit)
          .populate("createdBy", "username email")
          .lean()
          .exec(),
        inventoryModel.countDocuments(query),
      ]);

      return response.pagination(
        res,
        results,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all inventory"
      );
    } catch (error) {
      response.error(res, error, "failed to find all inventory");
      return;
    }
  },
};
