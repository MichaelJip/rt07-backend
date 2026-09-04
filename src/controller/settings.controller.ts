import { Response } from "express";
import mongoose from "mongoose";
import settingsModel from "../models/settings.model";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";

// Settings keys
export const SETTINGS_KEYS = {
  INITIAL_BALANCE: "initial_balance",
  FAMILY_RELATIONS: "family_relations",
  AGE_CATEGORIES: "age_categories",
};

// Defaults — admin can edit/add freely, these are just seed values. `id` is what
// family_members.relation actually stores/references — never the label — so renaming a
// label later doesn't orphan existing family members. Fixed slug ids here (rather than
// generated) so the defaults are stable across server restarts even before anyone has
// ever PATCHed this setting.
const DEFAULT_FAMILY_RELATIONS = [
  { id: "suami", label: "Suami" },
  { id: "istri", label: "Istri" },
  { id: "anak", label: "Anak" },
  { id: "orang_tua", label: "Orang Tua" },
  { id: "mertua", label: "Mertua" },
  { id: "kerabat", label: "Kerabat" },
  { id: "famili_lain", label: "Famili Lain" },
];

const DEFAULT_AGE_CATEGORIES = [
  { label: "Balita", min_age: 0, max_age: 5 },
  { label: "Anak", min_age: 6, max_age: 12 },
  { label: "Remaja", min_age: 13, max_age: 17 },
  { label: "Dewasa", min_age: 18, max_age: 59 },
  { label: "Lansia", min_age: 60, max_age: 200 },
];

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

  // Get family relation types (Suami/Istri/Anak/dll) — public, needed by any form that
  // lets someone pick a relation
  async getFamilyRelations(req: IReqUser, res: Response): Promise<void> {
    try {
      const value = await getSettingValue(
        SETTINGS_KEYS.FAMILY_RELATIONS,
        DEFAULT_FAMILY_RELATIONS
      );
      return response.success(res, { family_relations: value }, "success get family relations");
    } catch (error) {
      response.error(res, error, "failed to get family relations");
      return;
    }
  },

  // Replace the whole family relations list (Admin only). Items are { id?, label } —
  // `id` is optional per item: omit it for a brand-new relation and one is generated;
  // include it (round-tripped from a GET) to keep an existing relation's id stable while
  // editing its label.
  async updateFamilyRelations(req: IReqUser, res: Response): Promise<void> {
    try {
      const { family_relations } = req.body;

      const shapeValid =
        Array.isArray(family_relations) &&
        family_relations.length > 0 &&
        family_relations.every(
          (r) =>
            r &&
            typeof r.label === "string" &&
            r.label.trim() &&
            (r.id === undefined || (typeof r.id === "string" && r.id.trim()))
        );

      if (!shapeValid) {
        response.error(
          res,
          "family_relations must be a non-empty array of { id?, label }",
          "validation error"
        );
        return;
      }

      const withIds = family_relations.map((r: { id?: string; label: string }) => ({
        id: r.id?.trim() || new mongoose.Types.ObjectId().toString(),
        label: r.label.trim(),
      }));

      const ids = withIds.map((r: { id: string }) => r.id);
      if (new Set(ids).size !== ids.length) {
        response.error(res, "family_relations ids must be unique", "validation error");
        return;
      }

      // Case-insensitive: "Anak" and "anak" would otherwise show as two identical-looking
      // options in a dropdown with no way to tell them apart.
      const normalizedLabels = withIds.map((r: { label: string }) => r.label.toLowerCase());
      if (new Set(normalizedLabels).size !== normalizedLabels.length) {
        response.error(res, "family_relations labels must be unique", "validation error");
        return;
      }

      const result = await settingsModel.findOneAndUpdate(
        { key: SETTINGS_KEYS.FAMILY_RELATIONS },
        { key: SETTINGS_KEYS.FAMILY_RELATIONS, value: withIds },
        { upsert: true, new: true }
      );

      return response.success(
        res,
        { family_relations: result.value },
        "success update family relations"
      );
    } catch (error) {
      response.error(res, error, "failed to update family relations");
      return;
    }
  },

  // Get age-bracket categories (Balita/Anak/Remaja/dll) used by demographic reports
  async getAgeCategories(req: IReqUser, res: Response): Promise<void> {
    try {
      const value = await getSettingValue(SETTINGS_KEYS.AGE_CATEGORIES, DEFAULT_AGE_CATEGORIES);
      return response.success(res, { age_categories: value }, "success get age categories");
    } catch (error) {
      response.error(res, error, "failed to get age categories");
      return;
    }
  },

  // Replace the whole age category list (Admin only)
  async updateAgeCategories(req: IReqUser, res: Response): Promise<void> {
    try {
      const { age_categories } = req.body;

      const isValid =
        Array.isArray(age_categories) &&
        age_categories.length > 0 &&
        age_categories.every(
          (c) =>
            c &&
            typeof c.label === "string" &&
            c.label.trim() &&
            typeof c.min_age === "number" &&
            typeof c.max_age === "number" &&
            c.min_age >= 0 &&
            c.max_age >= c.min_age
        );

      if (!isValid) {
        response.error(
          res,
          "age_categories must be a non-empty array of { label, min_age, max_age }",
          "validation error"
        );
        return;
      }

      const result = await settingsModel.findOneAndUpdate(
        { key: SETTINGS_KEYS.AGE_CATEGORIES },
        { key: SETTINGS_KEYS.AGE_CATEGORIES, value: age_categories },
        { upsert: true, new: true }
      );

      return response.success(
        res,
        { age_categories: result.value },
        "success update age categories"
      );
    } catch (error) {
      response.error(res, error, "failed to update age categories");
      return;
    }
  },
};
