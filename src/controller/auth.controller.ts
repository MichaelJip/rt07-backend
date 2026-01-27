import { Response, Request } from "express";
import {
  UserDTO,
  UserLoginDTO,
  PushTokenDTO,
  UpdateProfileDTO,
} from "../utils/zodSchema";
import userModel, { User } from "../models/user.model";
import response from "../utils/response";
import { encrypt } from "../utils/encryption";
import { generateToken } from "../utils/jwt";
import { IReqUser } from "../utils/interface";
import { QueryFilter } from "mongoose";
import fs from "fs";
import path from "path";
import iuranModel from "../models/iuran.model";
import { IURAN_STATUS, ROLES, USER_STATUS } from "../utils/constants";
import ExcelJS from "exceljs";
import {
  createUserImportTemplate,
  exportUsersToExcel,
} from "../utils/excelTemplate";

export default {
  async register(req: Request, res: Response): Promise<void> {
    const { email, username, password, role, address, phone_number, position } =
      req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : "";

    const parsed = UserDTO.safeParse({
      email,
      username,
      password,
      role,
      address,
      position,
      phone_number,
      image_url,
    });

    if (!parsed.success) {
      response.error(res, parsed.error, "validation error");
      return;
    }

    const data = parsed.data;

    try {
      const existingUsername = await userModel.findOne({
        username: data.username,
      });
      if (existingUsername) {
        response.conflict(res, "Username is already taken");
        return;
      }

      const existingEmail = await userModel.findOne({ email: data.email });
      if (existingEmail) {
        response.conflict(res, "Email is already taken");
        return;
      }

      const result = await userModel.create(data);

      // Create iuran from current month until end of year if user is not ADMIN and is ACTIVE
      if (result.role !== ROLES.ADMIN && result.status === USER_STATUS.ACTIVE) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12
        const iuranPromises = [];

        // Create iuran from current month to December
        for (let month = currentMonth; month <= 12; month++) {
          const period = `${currentYear}-${String(month).padStart(2, "0")}`;
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
        }

        await Promise.all(iuranPromises);
        console.log(
          `Created ${iuranPromises.length} months of iuran for user ${result.username} (${currentYear}-${String(currentMonth).padStart(2, "0")} to ${currentYear}-12)`
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

      const userByIdentifier = await userModel.findOne({
        $or: [{ email: identifier }, { username: identifier }],
      });

      if (!userByIdentifier) {
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
      const { limit = 10, page = 1, search, status, includeDeleted } = req.query;

      let query: QueryFilter<User> = {};

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
        query.$or = [
          { username: searchRegex },
          { email: searchRegex },
          { address: searchRegex },
        ];
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
        return {
          ...user,
          unpaidIuranCount: unpaidData?.count || 0,
          unpaidIuranPeriods: unpaidData?.periods || [],
        };
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

  async updateUserStatus(req: IReqUser, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, statusNote } = req.body;

      if (!id) {
        response.error(res, "user id is required", "validation error");
        return;
      }

      const validStatuses = ["active", "inactive", "away"];
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

      // If user becomes inactive or away, delete their unpaid iuran
      if (status !== "active" && oldStatus === "active") {
        const deleteResult = await iuranModel.deleteMany({
          user: id,
          status: { $ne: IURAN_STATUS.PAID },
        });
        console.log(
          `User ${user.username} status changed to ${status}, removed ${deleteResult.deletedCount} unpaid iuran`
        );
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

      // Create iuran from current month to end of year
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      let iuranCreated = 0;

      for (let month = currentMonth; month <= 12; month++) {
        const period = `${currentYear}-${String(month).padStart(2, "0")}`;

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

        // Validation
        if (!email) {
          rowErrors.push("Email wajib diisi");
        } else if (!email.includes("@")) {
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
        const existingEmail = await userModel.findOne({ email });
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
          const newUser = await userModel.create({
            email,
            username,
            password: "password123", // Default password
            role,
            address,
            phone_number,
          });

          // Create iuran for non-admin users
          if (newUser.role !== ROLES.ADMIN) {
            const nextYear = new Date().getFullYear() + 1;
            const iuranPromises = [];

            for (let month = 1; month <= 12; month++) {
              const period = `${nextYear}-${String(month).padStart(2, "0")}`;
              iuranPromises.push(
                iuranModel.create({
                  user: newUser._id,
                  period: period,
                  amount: "50000",
                  type: "regular",
                  status: IURAN_STATUS.UNPAID,
                  submitted_at: null,
                  confirmed_at: null,
                  confirmed_by: null,
                })
              );
            }

            await Promise.all(iuranPromises);
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
