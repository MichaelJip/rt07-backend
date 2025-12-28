import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { IURAN_STATUS } from "../utils/constants";
import { IuranDTO } from "../utils/zodSchema";
import { USER_MODEL_NAME } from "./user.model";

export const IURAN_MODEL_NAME = "Iuran";

export type TIuran = z.infer<typeof IuranDTO>;

export interface Iuran
  extends Omit<
    TIuran,
    "user" | "submitted_at" | "confirmed_at" | "confirmed_by"
  > {
  user: Types.ObjectId;
  submitted_at?: Date | null;
  confirmed_at?: Date | null;
  confirmed_by?: Types.ObjectId | null;
  payment_date?: Date | null;
  payment_method?: string | null;
  recorded_by?: Types.ObjectId | null;
}

const Schema = mongoose.Schema;

const iuranSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: USER_MODEL_NAME,
      required: true,
    },
    period: {
      type: Schema.Types.String,
      required: true,
    },
    amount: {
      type: Schema.Types.String,
      required: true,
    },
    status: {
      type: Schema.Types.String,
      enum: [
        IURAN_STATUS.PENDING,
        IURAN_STATUS.UNPAID,
        IURAN_STATUS.REJECTED,
        IURAN_STATUS.PAID,
      ],
      default: IURAN_STATUS.UNPAID,
    },
    proof_image_url: {
      type: Schema.Types.String,
    },
    note: {
      type: Schema.Types.String,
    },
    type: {
      type: Schema.Types.String,
      enum: ["regular", "custom"],
      default: "regular",
    },

    submitted_at: {
      type: Schema.Types.Date,
      default: null,
    },
    confirmed_at: {
      type: Schema.Types.Date,
      default: null,
    },
    confirmed_by: {
      type: Schema.Types.ObjectId,
      ref: USER_MODEL_NAME,
      default: null,
    },
    payment_date: {
      type: Schema.Types.Date,
      default: null,
    },
    payment_method: {
      type: Schema.Types.String,
      default: null,
    },
    recorded_by: {
      type: Schema.Types.ObjectId,
      ref: USER_MODEL_NAME,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries (non-unique to allow multiple iuran per period)
iuranSchema.index({ user: 1, period: 1 });

const iuranModel = mongoose.model<Iuran>(IURAN_MODEL_NAME, iuranSchema);

export default iuranModel;
