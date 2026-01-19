import mongoose, { Types } from "mongoose";
import { USER_MODEL_NAME } from "./user.model";

export const PENGELUARAN_MODEL_NAME = "Pengeluaran";

export interface PengeluaranItem {
  name: string;
  price: number;
  image_url?: string;
}

export interface Pengeluaran {
  title: string;
  slug: string;
  items: PengeluaranItem[];
  total: number;
  created_by: Types.ObjectId;
  event_id?: Types.ObjectId; // Optional: linked to event if created from completeEvent
  created_at?: Date;
  updated_at?: Date;
}

const Schema = mongoose.Schema;

const pengeluaranItemSchema = new Schema(
  {
    name: {
      type: Schema.Types.String,
      required: true,
    },
    price: {
      type: Schema.Types.Number,
      required: true,
    },
    image_url: {
      type: Schema.Types.String,
    },
  },
  { _id: false }
);

const pengeluaranSchema = new Schema(
  {
    title: {
      type: Schema.Types.String,
      required: true,
    },
    slug: {
      type: Schema.Types.String,
      required: true,
      unique: true,
    },
    items: {
      type: [pengeluaranItemSchema],
      required: true,
      validate: {
        validator: function (items: PengeluaranItem[]) {
          return items.length > 0;
        },
        message: "At least one item is required",
      },
    },
    total: {
      type: Schema.Types.Number,
      required: true,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: USER_MODEL_NAME,
      required: true,
    },
    event_id: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const pengeluaranModel = mongoose.model<Pengeluaran>(
  PENGELUARAN_MODEL_NAME,
  pengeluaranSchema
);

export default pengeluaranModel;
