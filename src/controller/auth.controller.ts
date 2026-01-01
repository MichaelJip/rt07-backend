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
import { IURAN_STATUS, ROLES } from "../utils/constants";
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

      // Create 1 year of iuran for the next year if user is not ADMIN
      if (result.role !== ROLES.ADMIN) {
        const nextYear = new Date().getFullYear() + 1;
        const iuranPromises = [];

        for (let month = 1; month <= 12; month++) {
          const period = `${nextYear}-${String(month).padStart(2, "0")}`;
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
          `Created 12 months of iuran for user ${result.username} for year ${nextYear}`
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
      const { limit = 10, page = 1, search } = req.query;

      let query: QueryFilter<User> = {};

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

      if (user.image_url) {
        const imagePath = path.join(process.cwd(), user.image_url);
        if (fs.existsSync(imagePath)) {
          try {
            fs.unlinkSync(imagePath);
            console.log("User image deleted successfully");
          } catch (error) {
            console.error("Failed to delete user image:", error);
          }
        }
      }

      await iuranModel.deleteMany({ user: id });

      await userModel.findByIdAndDelete(id);

      return response.success(res, null, "user deleted successfully");
    } catch (error) {
      console.error("Delete user error:", error);
      response.error(res, error, "failed to delete user");
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
