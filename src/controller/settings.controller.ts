import { Response } from "express";
import settingsModel from "../models/settings.model";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";

// Settings keys
export const SETTINGS_KEYS = {
  INITIAL_BALANCE: "initial_balance",
};

// Helper function to get a setting value
export async function getSettingValue(key: string, defaultValue: any = null): Promise<any> {
  const setting = await settingsModel.findOne({ key }).lean();
  return setting ? setting.value : defaultValue;
}

export default {
  // Get all settings (Admin only)
  async getAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const settings = await settingsModel.find().lean();

      // Convert to key-value object
      const settingsObj: Record<string, any> = {};
      settings.forEach((s) => {
        settingsObj[s.key] = s.value;
      });

      // Set defaults if not exist
      if (settingsObj[SETTINGS_KEYS.INITIAL_BALANCE] === undefined) {
        settingsObj[SETTINGS_KEYS.INITIAL_BALANCE] = 0;
      }

      return response.success(res, settingsObj, "success get settings");
    } catch (error) {
      response.error(res, error, "failed to get settings");
      return;
    }
  },

  // Get initial balance (Admin only)
  async getInitialBalance(req: IReqUser, res: Response): Promise<void> {
    try {
      const value = await getSettingValue(SETTINGS_KEYS.INITIAL_BALANCE, 0);
      return response.success(
        res,
        { initial_balance: value },
        "success get initial balance"
      );
    } catch (error) {
      response.error(res, error, "failed to get initial balance");
      return;
    }
  },

  // Update initial balance (Admin only)
  async updateInitialBalance(req: IReqUser, res: Response): Promise<void> {
    try {
      const { initial_balance } = req.body;

      if (initial_balance === undefined || initial_balance === null) {
        response.error(
          res,
          "initial_balance is required",
          "validation error"
        );
        return;
      }

      const numericValue = Number(initial_balance);
      if (isNaN(numericValue)) {
        response.error(
          res,
          "initial_balance must be a number",
          "validation error"
        );
        return;
      }

      const result = await settingsModel.findOneAndUpdate(
        { key: SETTINGS_KEYS.INITIAL_BALANCE },
        { key: SETTINGS_KEYS.INITIAL_BALANCE, value: numericValue },
        { upsert: true, new: true }
      );

      return response.success(
        res,
        { initial_balance: result.value },
        "success update initial balance"
      );
    } catch (error) {
      response.error(res, error, "failed to update initial balance");
      return;
    }
  },
};
