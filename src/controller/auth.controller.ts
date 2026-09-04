import { Response, Request } from "express";
import {
  UserDTO,
  UserLoginDTO,
  PushTokenDTO,
  UpdateProfileDTO,
  FamilyMemberDTO,
} from "../utils/zodSchema";
import userModel from "../models/user.model";
import response from "../utils/response";
import { encrypt } from "../utils/encryption";
import { generateToken } from "../utils/jwt";
import { SECRET } from "../utils/env";
import jwt from "jsonwebtoken";
import { IReqUser } from "../utils/interface";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES, USER_STATUS } from "../utils/constants";
import ExcelJS from "exceljs";
import {
  createUserImportTemplate,
  exportUsersToExcel,
} from "../utils/excelTemplate";
import { getSettingValue, SETTINGS_KEYS } from "./settings.controller";
import { ageRangeToBirthDateFilter } from "../utils/age";

// family_members.relation stores a family_relations *id*, not the label — validates
// against whatever the admin currently has configured in Settings.
async function validateRelationId(relationId: string): Promise<string | null> {
  const relations = await getSettingValue(SETTINGS_KEYS.FAMILY_RELATIONS, null);
  if (!Array.isArray(relations)) return null; // nothing configured yet, don't block

  const match = relations.some((r: { id: string }) => r.id === relationId);
  if (match) return null;

  const options = relations.map((r: { id: string; label: string }) => `${r.id} (${r.label})`).join(", ");
  return `relation must be one of: ${options}`;
}

export default {
  async register(req: Request, res: Response): Promise<void> {
    const { email, username, password, role, address, phone_number, position, created_at } =
      req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : "";

    const parsed = UserDTO.safeParse({
      email: email || undefined,
      username,
      password: password || undefined,
      role,
      address,
      position,
      phone_number: phone_number || undefined,
      image_url,
    });

    if (!parsed.success) {
      response.error(res, parsed.error, "validation error");
      return;
    }

    const data = parsed.data;

    // Email required only for ADMIN role
    if (!data.email && data.role === ROLES.ADMIN) {
      response.error(res, "Email wajib diisi untuk role admin", "validation error");
      return;
    }

    // Password required only for ADMIN role, others default to password123
    if (!data.password) {
      if (data.role === ROLES.ADMIN) {
        response.error(res, "Password wajib diisi untuk role admin", "validation error");
        return;
      }
      data.password = "password123";
    }

    // Optional created_at ("YYYY-MM" or "YYYY-MM-DD"): warga sudah tinggal sejak bulan tersebut,
    // iuran dibuat mulai dari bulan itu sampai bulan sekarang
    let startYear: number | null = null;
    let startMonth: number | null = null;
    if (created_at) {
      const match = String(created_at).match(/^(\d{4})-(\d{2})(-\d{2})?$/);
      if (!match) {
        response.error(
          res,
          "Format created_at tidak valid. Gunakan YYYY-MM atau YYYY-MM-DD",
          "validation error"
        );
        return;
      }
      startYear = parseInt(match[1]);
      startMonth = parseInt(match[2]);

      const now = new Date();
      if (
        startMonth < 1 ||
        startMonth > 12 ||
        startYear > now.getFullYear() ||
        (startYear === now.getFullYear() && startMonth > now.getMonth() + 1)
      ) {
        response.error(
          res,
          "created_at tidak boleh di masa depan atau bulan tidak valid",
          "validation error"
        );
        return;
      }
    }

    try {
      const existingUsername = await userModel.findOne({
        username: data.username,
      });
      if (existingUsername) {
        response.conflict(res, "Username is already taken");
        return;
      }

      // Only check email uniqueness if email is provided
      if (data.email) {
        const existingEmail = await userModel.findOne({ email: data.email });
        if (existingEmail) {
          response.conflict(res, "Email is already taken");
          return;
        }
      }

      const createData: any = { ...data };
      if (!createData.email) {
        delete createData.email; // Don't store empty email
      }
      if (startYear && startMonth) {
        // Override default createdAt so it reflects when the warga actually moved in
        createData.createdAt = new Date(startYear, startMonth - 1, 1);
      }

      const result = await userModel.create(createData) as any;

      // Create iuran from start month (created_at) or current month, up to current month only.
      // Future months are handled by the monthly cron.
      if (result.role !== ROLES.ADMIN && result.status === USER_STATUS.ACTIVE) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12

        let year = startYear ?? currentYear;
        let month = startMonth ?? currentMonth;
        const iuranPromises = [];
        const firstPeriod = `${year}-${String(month).padStart(2, "0")}`;

        while (year < currentYear || (year === currentYear && month <= currentMonth)) {
          const period = `${year}-${String(month).padStart(2, "0")}`;
          iuranPromises.push(
            iuranModel.create({
              user: result._id,
              period: period,
              amount: "50000",
              type: "regular",
              status: IURAN_STATUS.UNPAID,
              submitted_at: null,
              confirmed_at: null,
              confirmed_by: null,
            })
          );
          month++;
          if (month > 12) {
            month = 1;
            year++;
          }
        }

        await Promise.all(iuranPromises);
        console.log(
          `Created ${iuranPromises.length} months of iuran for user ${result.username} (${firstPeriod} to ${currentYear}-${String(currentMonth).padStart(2, "0")})`
        );
      }

      response.success(res, result, "success register");
      return;
    } catch (error) {
      console.error("REGISTER ERROR:", error);
      response.error(res, error, "failed to register user");
      return;
    }
  },
  async login(req: Request, res: Response): Promise<void> {
    const { identifier, password } = req.body;

    try {
      await UserLoginDTO.safeParse({ identifier, password });

      // Find by username or email (email may not exist for warga)
      const userByIdentifier = await userModel.findOne({
        $or: [
          { username: identifier },
          { email: identifier },
        ],
      } as any);

      if (!userByIdentifier) {
        return response.unauthorized(res, "user not found");
      }

      // Block login for moved users
      if (userByIdentifier.status === USER_STATUS.MOVED) {
        return response.unauthorized(res, "Akun Anda telah dinonaktifkan karena status pindah");
      }

      // Block login for deleted users
      if (userByIdentifier.isDeleted) {
        return response.unauthorized(res, "user not found");
      }

      const validatePassword: boolean =
        encrypt(password) === userByIdentifier?.password;

      if (!validatePassword) {
        return response.unauthorized(res, "user not found");
      }

      const token = generateToken({
        id: userByIdentifier._id,
        role: userByIdentifier.role,
      });

      return response.success(res, token, "login success");
    } catch (error) {
      response.error(res, error, "failed to login");
      return;
    }
  },
  async me(req: IReqUser, res: Response): Promise<void> {
    try {
      const user = req.user;
      const result = await userModel
        .findById(user?.id)
        .select("-password")
        .lean();
      return response.success(res, result, "success get user profile");
    } catch (error) {
      response.error(res, error, "failed to get user profile");
      return;
    }
  },
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const { limit = 10, page = 1, search, status, includeDeleted, full, minAge, maxAge } = req.query;

      // ?full=true requires a valid auth token with privileged role
      const isFullRequest = full === "true";
      if (isFullRequest) {
        // Manually verify token if present
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          response.unauthorized(res, "Authentication required for full data");
          return;
        }
        try {
          const decoded: any = jwt.verify(token, SECRET);
          const privilegedRoles = [ROLES.ADMIN, ROLES.BENDAHARA, ROLES.SEKRETARIS, ROLES.RT, ROLES.RW];
          if (!privilegedRoles.includes(decoded.role)) {
            response.unauthorized(res, "Insufficient permissions for full data");
            return;
          }
        } catch {
          response.unauthorized(res, "Invalid or expired token");
          return;
        }
      }

      // `any` here (not QueryFilter<User>): User's TS type is inferred from UserDTO
      // (birth_date: string, no family_members), but the actual Mongoose schema stores
      // birth_date as Date and has family_members — same "avoid TS friction" tradeoff
      // as userModel.create(data) as any elsewhere in this file.
      let query: any = {};

      // By default, exclude deleted users unless includeDeleted=true
      if (includeDeleted !== "true") {
        query.isDeleted = { $ne: true };
      }

      // Filter by status (active, inactive, away)
      if (status && typeof status === "string") {
        query.status = status;
      }

      if (search && typeof search === "string") {
        const searchRegex = new RegExp(search, "i");
        // A hit on any family member's name still returns the parent User doc — the
        // household already ships as one record via family_members[], so searching
        // either the kepala keluarga or one of their kids surfaces the same result.
        query.$or = [
          { username: searchRegex },
          { email: searchRegex },
          { address: searchRegex },
          { "family_members.name": searchRegex },
        ];
      }

      // Age-range filter: matches either the head of household's own birth_date, or
      // any family member's birth_date (household counts as a match if anyone in it
      // falls in range — used for things like "berapa KK punya balita").
      const birthDateFilter = ageRangeToBirthDateFilter(
        minAge !== undefined ? Number(minAge) : undefined,
        maxAge !== undefined ? Number(maxAge) : undefined
      );
      if (birthDateFilter) {
        const ageOr = [
          { birth_date: birthDateFilter },
          { family_members: { $elemMatch: { birth_date: birthDateFilter } } },
        ];
        // Combine with any existing $or (search) via $and so both conditions apply.
        if (query.$or) {
          query.$and = [{ $or: query.$or }, { $or: ageOr }];
          delete query.$or;
        } else {
          query.$or = ageOr;
        }
      }

      const allResults = await userModel
        .find(query)
        .select("-password")
        .sort({ isDeleted: 1, status: 1, username: 1 }) // Sort: active first, then by name
        .lean()
        .exec();

      const paginatedResult = allResults.slice(
        (+page - 1) * +limit,
        +page * +limit
      );

      // Get unpaid regular iuran periods for each user in paginated results
      const userIds = paginatedResult.map((user: any) => user._id);
      const unpaidIuran = await iuranModel.aggregate([
        {
          $match: {
            user: { $in: userIds },
            status: "unpaid",
            type: "regular", // Only get regular iuran, not event donations
          },
        },
        {
          $sort: { period: 1 }, // Sort periods chronologically
        },
        {
          $group: {
            _id: "$user",
            unpaidPeriods: { $push: "$period" },
            unpaidCount: { $sum: 1 },
          },
        },
      ]);

      // Create a map for quick lookup
      const unpaidMap = new Map(
        unpaidIuran.map((item) => [
          item._id.toString(),
          {
            periods: item.unpaidPeriods,
            count: item.unpaidCount,
          },
        ])
      );

      // Add unpaid periods to each user
      const resultWithUnpaid = paginatedResult.map((user: any) => {
        const unpaidData = unpaidMap.get(user._id.toString());
        const baseFields = {
          _id: user._id,
          username: user.username,
          address: user.address,
          phone_number: user.phone_number,
          status: user.status,
          role: user.role,
          image_url: user.image_url,
          unpaidIuranCount: unpaidData?.count || 0,
          unpaidIuranPeriods: unpaidData?.periods || [],
        };

        if (isFullRequest) {
          // Return full data for admin CMS
          return {
            ...user,
            unpaidIuranCount: unpaidData?.count || 0,
            unpaidIuranPeriods: unpaidData?.periods || [],
          };
        }

        return baseFields;
      });

      const count = allResults.length;

      return response.pagination(
        res,
        resultWithUnpaid,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all user"
      );
    } catch (error) {
      response.error(res, error, "failed to find all user");
      return;
    }
  },
  async updatePushToken(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { pushToken } = req.body;

      const parsed = PushTokenDTO.safeParse({ pushToken });

      if (!parsed.success) {
        response.error(res, parsed.error, "validation error");
        return;
      }

      const result = await userModel
        .findByIdAndUpdate(
          userId,
          { expoPushToken: parsed.data.pushToken },
          { new: true }
        )
        .select("-password");

      if (!result) {
        response.notFound(res, "user not found");
        return;
      }

      return response.success(res, result, "push token updated successfully");
    } catch (error) {
      response.error(res, error, "failed to update push token");
      return;
    }
  },
  async updateProfile(req: IReqUser, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { username, address, position, phone_number } = req.body;
      const image_url = req.file ? `/uploads/${req.file.filename}` : undefined;

      console.log("Update Profile Request:");
      console.log("- Body:", { username, address, position, phone_number });
      console.log("- File uploaded:", req.file ? "Yes" : "No");
      console.log("- Image URL:", image_url);

      const parsed = UpdateProfileDTO.safeParse({
        username,
        address,
        position,
        phone_number,
        image_url,
      });

      if (!parsed.success) {
        console.log("Validation error:", parsed.error);
        response.error(res, parsed.error, "validation error");
        return;
      }

      // Check if username is being updated and if it's already taken
      if (parsed.data.username) {
        const existingUser = await userModel.findOne({
          username: parsed.data.username,
          _id: { $ne: userId },
        });

        if (existingUser) {
          response.conflict(res, "Username is already taken");
          return;
        }
      }

      // If new image is uploaded, delete the old one
      if (image_url) {
        const currentUser = await userModel.findById(userId);
        if (currentUser?.image_url) {
          const oldImagePath = path.join(process.cwd(), currentUser.image_url);
          console.log("Attempting to delete old image:", oldImagePath);
          if (fs.existsSync(oldImagePath)) {
            try {
              fs.unlinkSync(oldImagePath);
              console.log("Old image deleted successfully");
            } catch (error) {
              console.error("Failed to delete old image:", error);
            }
          } else {
            console.log("Old image file does not exist");
          }
        }
      }

      // Filter out undefined values to only update provided fields
      const updateData = Object.fromEntries(
        Object.entries(parsed.data).filter(([_, value]) => value !== undefined)
      );

      console.log("Update data:", updateData);

      const result = await userModel
        .findByIdAndUpdate(userId, updateData, { new: true })
        .select("-password");

      if (!result) {
        response.notFound(res, "user not found");
        return;
      }

      console.log("Profile updated successfully");
      return response.success(res, result, "profile updated successfully");
    } catch (error) {
      console.error("Update profile error:", error);
      response.error(res, error, "failed to update profile");
      return;
    }
  },
  // Single-user fetch for the admin edit page (full record, including family_members/
  // birth_date — route is admin-only so no need for the ?full=true gate GET /user uses).
  async findOne(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id || !mongoose.isValidObjectId(id)) {
        response.error(res, "invalid user id", "validation error");
        return;
      }

      const user = await userModel.findById(id).select("-password");
      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      return response.success(res, user, "success get user");
    } catch (error) {
      response.error(res, error, "failed to get user");
      return;
    }
  },
  async deleteUser(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        response.conflict(res, "user id is required");
        return;
      }

      const user = await userModel.findById(id);

      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      // Soft delete: mark user as deleted
      await userModel.findByIdAndUpdate(id, {
        isDeleted: true,
        deletedAt: new Date(),
      });

      // Delete only UNPAID iuran, keep PAID iuran for history
      const deleteResult = await iuranModel.deleteMany({
        user: id,
        status: { $ne: IURAN_STATUS.PAID },
      });

      console.log(
        `Soft deleted user ${user.username}, removed ${deleteResult.deletedCount} unpaid iuran records`
      );

      return response.success(
        res,
        {
          deletedUnpaidIuran: deleteResult.deletedCount,
        },
        "user deleted successfully (paid iuran history preserved)"
      );
    } catch (error) {
      console.error("Delete user error:", error);
      response.error(res, error, "failed to delete user");
      return;
    }
  },

  async updateUser(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id || !mongoose.isValidObjectId(id)) {
        response.error(res, "invalid user id", "validation error");
        return;
      }

      const user = await userModel.findById(id);
      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      const { username, email, address, phone_number, role, birth_date } = req.body;
      const image_url = req.file ? `/uploads/${req.file.filename}` : undefined;

      // Check username uniqueness if changing
      if (username && username !== user.username) {
        const existing = await userModel.findOne({ username, _id: { $ne: id } });
        if (existing) {
          response.conflict(res, "Username is already taken");
          return;
        }
      }

      // Check email uniqueness if changing
      if (email && email !== user.email) {
        const existing = await userModel.findOne({ email, _id: { $ne: id } });
        if (existing) {
          response.conflict(res, "Email is already taken");
          return;
        }
      }

      // If new image, delete old one
      if (image_url && user.image_url) {
        const oldPath = path.join(process.cwd(), user.image_url);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch {}
        }
      }

      const updateData: Record<string, any> = {};
      if (username !== undefined) updateData.username = username;
      if (email !== undefined) updateData.email = email || null;
      if (address !== undefined) updateData.address = address;
      if (phone_number !== undefined) updateData.phone_number = phone_number;
      if (role !== undefined) updateData.role = role;
      if (image_url !== undefined) updateData.image_url = image_url;
      if (birth_date !== undefined) updateData.birth_date = birth_date || null;

      const result = await userModel
        .findByIdAndUpdate(id, updateData, { new: true })
        .select("-password");

      return response.success(res, result, "user updated successfully");
    } catch (error) {
      response.error(res, error, "failed to update user");
      return;
    }
  },

  // Add one household member to a User's family_members[]. `relation` must be one of
  // the admin-configurable options in Settings (family_relations) — keeps the reference
  // list meaningful instead of becoming free-text drift.
  async addFamilyMember(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id || !mongoose.isValidObjectId(id)) {
        response.error(res, "invalid user id", "validation error");
        return;
      }

      const parsed = FamilyMemberDTO.safeParse(req.body);
      if (!parsed.success) {
        response.error(res, parsed.error, "validation error");
        return;
      }

      const relationError = await validateRelationId(parsed.data.relation);
      if (relationError) {
        response.error(res, relationError, "validation error");
        return;
      }

      const user = await userModel.findByIdAndUpdate(
        id,
        { $push: { family_members: parsed.data } },
        { new: true }
      ).select("-password");

      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      return response.success(res, user, "family member added");
    } catch (error) {
      response.error(res, error, "failed to add family member");
      return;
    }
  },

  async updateFamilyMember(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, memberId } = req.params;

      if (!id || !mongoose.isValidObjectId(id) || !memberId || !mongoose.isValidObjectId(memberId)) {
        response.error(res, "invalid user id or family member id", "validation error");
        return;
      }

      const parsed = FamilyMemberDTO.partial().safeParse(req.body);
      if (!parsed.success) {
        response.error(res, parsed.error, "validation error");
        return;
      }

      if (parsed.data.relation) {
        const relationError = await validateRelationId(parsed.data.relation);
        if (relationError) {
          response.error(res, relationError, "validation error");
          return;
        }
      }

      const setFields: Record<string, any> = {};
      if (parsed.data.name !== undefined) setFields["family_members.$.name"] = parsed.data.name;
      if (parsed.data.birth_date !== undefined) setFields["family_members.$.birth_date"] = parsed.data.birth_date;
      if (parsed.data.relation !== undefined) setFields["family_members.$.relation"] = parsed.data.relation;

      const user = await userModel.findOneAndUpdate(
        { _id: id, "family_members._id": memberId },
        { $set: setFields },
        { new: true }
      ).select("-password");

      if (!user) {
        response.notFound(res, "user or family member not found");
        return;
      }

      return response.success(res, user, "family member updated");
    } catch (error) {
      response.error(res, error, "failed to update family member");
      return;
    }
  },

  async deleteFamilyMember(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id, memberId } = req.params;

      if (!id || !mongoose.isValidObjectId(id) || !memberId || !mongoose.isValidObjectId(memberId)) {
        response.error(res, "invalid user id or family member id", "validation error");
        return;
      }

      const user = await userModel.findByIdAndUpdate(
        id,
        { $pull: { family_members: { _id: memberId } } },
        { new: true }
      ).select("-password");

      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      return response.success(res, user, "family member removed");
    } catch (error) {
      response.error(res, error, "failed to remove family member");
      return;
    }
  },

  async updateUserStatus(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, statusNote } = req.body;

      if (!id) {
        response.error(res, "user id is required", "validation error");
        return;
      }

      const validStatuses = ["active", "inactive", "away", "moved"];
      if (!status || !validStatuses.includes(status)) {
        response.error(
          res,
          `status must be one of: ${validStatuses.join(", ")}`,
          "validation error"
        );
        return;
      }

      const user = await userModel.findById(id);

      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      const oldStatus = user.status;

      // Update user status
      const updatedUser = await userModel
        .findByIdAndUpdate(
          id,
          {
            status,
            statusNote: statusNote || null,
          },
          { new: true }
        )
        .select("-password");

      // If user becomes moved/inactive, delete all UNPAID iuran
      if ((status === "moved" || status === "inactive") && oldStatus === "active") {
        const deleteResult = await iuranModel.deleteMany({
          user: id,
          status: { $ne: IURAN_STATUS.PAID },
        });
        console.log(`User ${user.username} status changed to ${status}, removed ${deleteResult.deletedCount} unpaid iuran records`);
      }

      // If user becomes active from inactive/away/moved, create iuran for current month only
      // (future months are handled by the monthly cron)
      if (status === "active" && oldStatus !== "active") {
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const exists = await iuranModel.findOne({ user: id, period, type: "regular" });
        if (!exists) {
          await iuranModel.create({
            user: id,
            period,
            amount: "50000",
            type: "regular",
            status: IURAN_STATUS.UNPAID,
            submitted_at: null,
            confirmed_at: null,
            confirmed_by: null,
          });
        }
        console.log(`User ${user.username} status changed to active, iuran ensured for current month`);
      }

      return response.success(res, updatedUser, "user status updated successfully");
    } catch (error) {
      console.error("Update user status error:", error);
      response.error(res, error, "failed to update user status");
      return;
    }
  },

  async restoreUser(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        response.error(res, "user id is required", "validation error");
        return;
      }

      const user = await userModel.findById(id);

      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      if (!user.isDeleted) {
        response.error(res, "user is not deleted", "validation error");
        return;
      }

      // Restore user
      const restoredUser = await userModel
        .findByIdAndUpdate(
          id,
          {
            isDeleted: false,
            deletedAt: null,
            status: "active",
          },
          { new: true }
        )
        .select("-password");

      // Create iuran for current month only (future months are handled by the monthly cron)
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let iuranCreated = 0;

      const exists = await iuranModel.findOne({
        user: id,
        period: period,
        type: "regular",
      });

      if (!exists) {
        await iuranModel.create({
          user: id,
          period: period,
          amount: "50000",
          type: "regular",
          status: IURAN_STATUS.UNPAID,
        });
        iuranCreated++;
      }

      console.log(
        `Restored user ${user.username}, created ${iuranCreated} iuran records`
      );

      return response.success(
        res,
        {
          user: restoredUser,
          iuranCreated,
        },
        "user restored successfully"
      );
    } catch (error) {
      console.error("Restore user error:", error);
      response.error(res, error, "failed to restore user");
      return;
    }
  },

  async downloadTemplate(req: Request, res: Response): Promise<void> {
    try {
      const buffer = await createUserImportTemplate();

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Template_Import_User.xlsx"
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Download template error:", error);
      response.error(res, error, "failed to download template");
      return;
    }
  },

  async importUsers(req: IReqUser, res: Response): Promise<void> {
    try {
      if (!req.file) {
        response.conflict(res, "File Excel tidak ditemukan");
        return;
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer as any);

      const worksheet = workbook.getWorksheet("Data Pengguna");

      if (!worksheet) {
        response.conflict(
          res,
          "Sheet 'Data Pengguna' tidak ditemukan di file Excel"
        );
        return;
      }

      const results = {
        success: [] as string[],
        skipped: [] as string[],
        errors: [] as { row: number; email: string; errors: string[] }[],
      };

      const rowsToProcess: any[] = [];

      // Start from row 2 (skip header)
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        const email = row.getCell(1).value?.toString().trim();
        const username = row.getCell(2).value?.toString().trim();
        const role = row.getCell(3).value?.toString().trim();
        const address = row.getCell(4).value?.toString().trim() || "";
        const phone_number = row.getCell(5).value?.toString().trim() || "";

        // Skip empty rows
        if (!email && !username) return;

        rowsToProcess.push({
          rowNumber,
          email,
          username,
          role,
          address,
          phone_number,
        });
      });

      // Process each row
      for (const rowData of rowsToProcess) {
        const { rowNumber, email, username, role, address, phone_number } =
          rowData;
        const rowErrors: string[] = [];

        // Validation: email required only for admin role
        if (role === ROLES.ADMIN && !email) {
          rowErrors.push("Email wajib diisi untuk role admin");
        } else if (email && !email.includes("@")) {
          rowErrors.push("Format email tidak valid");
        }

        if (!username) {
          rowErrors.push("Nama pengguna wajib diisi");
        }

        if (!role) {
          rowErrors.push("Peran wajib diisi");
        } else {
          const validRoles = [
            ROLES.ADMIN,
            ROLES.RT,
            ROLES.RW,
            ROLES.BENDAHARA,
            ROLES.SEKRETARIS,
            ROLES.SATPAM,
            ROLES.WARGA,
          ];
          if (!validRoles.includes(role as any)) {
            rowErrors.push(
              `Peran tidak valid. Pilihan: ${validRoles.join(", ")}`
            );
          }
        }

        if (phone_number && (phone_number.length < 10 || phone_number.length > 15)) {
          rowErrors.push("No. telepon harus 10-15 digit");
        }

        if (rowErrors.length > 0) {
          results.errors.push({
            row: rowNumber,
            email: email || "N/A",
            errors: rowErrors,
          });
          continue;
        }

        // Check for existing user
        const existingEmail = email ? await userModel.findOne({ email }) : null;
        const existingUsername = await userModel.findOne({ username });

        if (existingEmail || existingUsername) {
          const skipReason = [];
          if (existingEmail) skipReason.push("email sudah terdaftar");
          if (existingUsername) skipReason.push("username sudah terdaftar");

          results.skipped.push(
            `Baris ${rowNumber} (${email}): ${skipReason.join(", ")}`
          );
          continue;
        }

        // Create user
        try {
          const userData: any = {
            username,
            password: "password123", // Default password
            role,
            address,
            phone_number,
          };
          if (email) userData.email = email;

          const newUser = await userModel.create(userData) as any;

          // Create iuran for current month only (future months are handled by the monthly cron)
          if (newUser.role !== ROLES.ADMIN) {
            const now = new Date();
            const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            await iuranModel.create({
              user: newUser._id,
              period: period,
              amount: "50000",
              type: "regular",
              status: IURAN_STATUS.UNPAID,
              submitted_at: null,
              confirmed_at: null,
              confirmed_by: null,
            });
          }

          results.success.push(`Baris ${rowNumber} (${email}): berhasil dibuat`);
        } catch (error: any) {
          results.errors.push({
            row: rowNumber,
            email,
            errors: [error.message || "Gagal membuat user"],
          });
        }
      }

      return response.success(
        res,
        results,
        `Import selesai. Berhasil: ${results.success.length}, Dilewati: ${results.skipped.length}, Error: ${results.errors.length}`
      );
    } catch (error) {
      console.error("Import users error:", error);
      response.error(res, error, "Gagal import user");
      return;
    }
  },

  async exportUsers(req: IReqUser, res: Response): Promise<void> {
    try {
      const { ids } = req.query;

      let query: any = {};

      // If IDs are provided, filter by those IDs
      if (ids) {
        const userIds = Array.isArray(ids) ? ids : [ids];
        query._id = { $in: userIds };
      }

      const users = await userModel
        .find(query)
        .select("-password")
        .lean()
        .exec();

      if (users.length === 0) {
        response.notFound(res, "Tidak ada user yang ditemukan untuk di-export");
        return;
      }

      const buffer = await exportUsersToExcel(users);

      const filename = ids
        ? `Export_Selected_Users_${new Date().toISOString().split("T")[0]}.xlsx`
        : `Export_All_Users_${new Date().toISOString().split("T")[0]}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${filename}`
      );

      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Export users error:", error);
      response.error(res, error, "Gagal export user");
      return;
    }
  },
};
