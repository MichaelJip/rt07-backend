import mongoose from "mongoose";

export const SETTINGS_MODEL_NAME = "Settings";

export interface Settings {
  key: string;
  value: any;
  updated_at?: Date;
}

const Schema = mongoose.Schema;

const settingsSchema = new Schema(
  {
    key: {
      type: Schema.Types.String,
      required: true,
      unique: true,
      index: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: "updated_at" },
  }
);

const settingsModel = mongoose.model<Settings>(
  SETTINGS_MODEL_NAME,
  settingsSchema
);

export default settingsModel;
