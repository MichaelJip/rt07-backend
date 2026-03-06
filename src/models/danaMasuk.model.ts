import mongoose, { Types } from "mongoose";

export const DANA_MASUK_MODEL_NAME = "DanaMasuk";

export interface DanaMasuk {
  nama_pemberi: string;
  nominal: number;
  keterangan?: string;
  created_by: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const Schema = mongoose.Schema;

const danaMasukSchema = new Schema(
  {
    nama_pemberi: {
      type: Schema.Types.String,
      required: true,
    },
    nominal: {
      type: Schema.Types.Number,
      required: true,
      min: 0,
    },
    keterangan: {
      type: Schema.Types.String,
      default: null,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

const danaMasukModel = mongoose.model<DanaMasuk>(DANA_MASUK_MODEL_NAME, danaMasukSchema);

export default danaMasukModel;
