import { minLength, z } from "zod";
import { InventoryDTO } from "../utils/zodSchema";
import mongoose from "mongoose";

export const INVENTORY_MODEL_NAME = "Inventory";

export type TInventory = z.infer<typeof InventoryDTO>;

export interface Inventory extends Omit<TInventory, ""> {}

const Schema = mongoose.Schema;

const inventorySchema = new Schema(
  {
    name: {
      type: Schema.Types.String,
      required: true,
      unique: true,
    },
    quantity: {
      type: Schema.Types.String,
      required: true,
      minLength: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

const inventoryModel = mongoose.model<Inventory>(
  INVENTORY_MODEL_NAME,
  inventorySchema
);

export default inventoryModel;
