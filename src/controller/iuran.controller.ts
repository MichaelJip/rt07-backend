import { Response } from "express";
import mongoose, { QueryFilter, Types } from "mongoose";
import iuranModel, { Iuran } from "../models/iuran.model";
import { IURAN_STATUS, ROLES } from "../utils/constants";
import { IReqUser } from "../utils/interface";
import response from "../utils/response";
import userModel from "../models/user.model";
import { generateReceiptPDF } from "../utils/pdfGenerator";
import {
  createIuranImportTemplate,
  parseIuranImportFile,
} from "../utils/excelTemplate";
import ExcelJS from "exceljs";
import fs from "fs";

export default {
  async findAll(req: IReqUser, res: Response): Promise<void> {
    try {
      const {
        limit = 10,
        page = 1,
        search,
        status,
        period,
        userId,
      } = req.query;

      // Build query
      let query: QueryFilter<Iuran> = {};

      // Filter by user (for Bendahara to see specific user's iuran)
      if (userId) {
        if (!mongoose.isValidObjectId(userId)) {
          response.error(res, "invalid user id", "validation error");
          return;
        }
        query.user = new Types.ObjectId(userId as string);
      }

      // Filter by period (exact match)
      if (period) {
        query.period = period as string;
      }

      // Filter by status (single or multiple comma-separated values)
      if (status) {
        const statusArray = (status as string).split(",").map((s) => s.trim());
        if (statusArray.length === 1) {
          query.status = statusArray[0];
        } else {
          query.status = { $in: statusArray };
        }
      }

      // Search by period (if no exact period filter)
      if (search && !period) {
        query.period = { $regex: search as string, $options: "i" };
      }

      const result = await iuranModel
        .find(query)
        .populate("user", "username")
        .populate("confirmed_by", "username")
        .limit(+limit)
        .skip((+page - 1) * +limit)
        .sort({ created_at: -1 })
        .lean()
        .exec();

      const count = await iuranModel.countDocuments(query);

      return response.pagination(
        res,
        result,
        {
          total: count,
          totalPages: Math.ceil(count / +limit),
          current: +page,
        },
        "success find all iuran"
      );
    } catch (error) {
      response.error(res, error, "failed to find all iuran");
      return;
    }
  },
  async recordPayment(req: IReqUser, res: Response): Promise<void> {
    try {
      const bendaharaId = req.user?.id;
      if (!bendaharaId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const { userId, amount, periods, payment_date, payment_method, note } =
        req.body;

      if (
        !userId ||
        !amount ||
        !periods ||
        !Array.isArray(periods) ||
        periods.length === 0
      ) {
        response.error(
          res,
          "userId, amount, and periods array are required",
          "validation error"
        );
        return;
      }

      if (!mongoose.isValidObjectId(userId)) {
        response.error(res, "invalid user id", "validation error");
        return;
      }

      const user = await userModel.findById(userId);
      if (!user) {
        response.notFound(res, "user not found");
        return;
      }

      // Validate amount
      const totalAmount = Number(amount);
      const REQUIRED_AMOUNT_PER_PERIOD = 50000;
      const expectedTotalAmount = REQUIRED_AMOUNT_PER_PERIOD * periods.length;

      if (isNaN(totalAmount) || totalAmount <= 0) {
        response.error(res, "invalid amount", "validation error");
        return;
      }

      // Check if amount matches exactly (50k per period)
      if (totalAmount !== expectedTotalAmount) {
        response.error(
          res,
          `invalid amount. For ${
            periods.length
          } period(s), you must pay exactly Rp ${expectedTotalAmount.toLocaleString(
            "id-ID"
          )} (Rp ${REQUIRED_AMOUNT_PER_PERIOD.toLocaleString(
            "id-ID"
          )} per period). You provided Rp ${totalAmount.toLocaleString(
            "id-ID"
          )}`,
          "validation error"
        );
        return;
      }

      // Calculate amount per period
      const amountPerPeriod = REQUIRED_AMOUNT_PER_PERIOD;

      const now = new Date();
      const paymentDate = payment_date ? new Date(payment_date) : now;
      const updatedIuran = [];
      const errors = [];

      // Update each period
      for (const period of periods) {
        try {
          // Find unpaid iuran for this user and period
          const iuran = await iuranModel.findOne({
            user: new Types.ObjectId(userId),
            period: period,
            status: IURAN_STATUS.UNPAID,
          });

          if (!iuran) {
            errors.push(`Period ${period}: No unpaid iuran found`);
            continue;
          }

          // Update to paid
          const result = await iuranModel.findByIdAndUpdate(
            iuran._id,
            {
              status: IURAN_STATUS.PAID,
              amount: String(amountPerPeriod),
              payment_date: paymentDate,
              payment_method: payment_method || null,
              note: note || null,
              confirmed_at: now,
              confirmed_by: bendaharaId,
              recorded_by: bendaharaId,
            },
            { new: true }
          );

          updatedIuran.push(result);
        } catch (error: any) {
          errors.push(`Period ${period}: ${error.message}`);
        }
      }

      return response.success(
        res,
        {
          success: updatedIuran.length,
          failed: errors.length,
          updatedIuran,
          errors: errors.length > 0 ? errors : null,
        },
        `Successfully recorded ${updatedIuran.length} payment(s)`
      );
    } catch (error) {
      response.error(res, error, "failed to record payment");
      return;
    }
  },
  async getStatusSummary(req: IReqUser, res: Response): Promise<void> {
    try {
      const { period } = req.params;

      if (!period) {
        response.error(res, "period is required", "validation error");
        return;
      }

      const statusCounts = await iuranModel.aggregate([
        { $match: { period } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const summary = {
        paid: 0,
        pending: 0,
        rejected: 0,
        unpaid: 0,
      };

      statusCounts.forEach((item) => {
        if (item._id in summary) {
          summary[item._id as keyof typeof summary] = item.count;
        }
      });

      return response.success(res, summary, "success get status summary");
    } catch (error) {
      response.error(res, error, "failed to get status summary");
      return;
    }
  },
  async generateReceipt(req: IReqUser, res: Response): Promise<void> {
    try {
      const { ids } = req.query;

      if (!ids || typeof ids !== "string") {
        response.error(
          res,
          "ids parameter is required (comma-separated iuran IDs)",
          "validation error"
        );
        return;
      }

      // Parse comma-separated IDs
      const iuranIds = ids.split(",").map((id) => id.trim());

      if (iuranIds.length === 0) {
        response.error(
          res,
          "at least one iuran ID is required",
          "validation error"
        );
        return;
      }

      // Validate all IDs
      for (const id of iuranIds) {
        if (!mongoose.isValidObjectId(id)) {
          response.error(res, `invalid iuran ID: ${id}`, "validation error");
          return;
        }
      }

      // Fetch iuran records
      const iuranRecords = await iuranModel
        .find({
          _id: { $in: iuranIds },
          status: IURAN_STATUS.PAID,
        })
        .populate("user", "username email")
        .populate("recorded_by", "username")
        .lean();

      if (iuranRecords.length === 0) {
        response.notFound(
          res,
          "no paid iuran records found with the provided IDs"
        );
        return;
      }

      // Validate all iuran belong to the same user
      const userIds = new Set(
        iuranRecords.map((iuran: any) => iuran.user._id.toString())
      );
      if (userIds.size > 1) {
        response.error(
          res,
          "all iuran records must belong to the same user",
          "validation error"
        );
        return;
      }

      // Calculate totals
      const totalAmount = iuranRecords.reduce(
        (sum, iuran: any) => sum + Number(iuran.amount),
        0
      );
      const amountPerPeriod = Number(iuranRecords[0].amount);

      // Get user and recorder info
      const userInfo = iuranRecords[0].user as any;
      const recorderInfo = iuranRecords[0].recorded_by as any;

      // Prepare receipt data
      const receiptData = {
        receiptNumber: `RCP-${Date.now()}-${userInfo._id.toString().slice(-6)}`,
        receiptDate: new Date(),
        paymentDate: new Date(iuranRecords[0].payment_date || new Date()),
        user: {
          id: userInfo._id.toString(),
          username: userInfo.username,
          email: userInfo.email,
        },
        periods: iuranRecords.map((iuran: any) => iuran.period).sort(),
        amountPerPeriod: amountPerPeriod,
        totalPeriods: iuranRecords.length,
        totalAmount: totalAmount,
        paymentMethod: iuranRecords[0].payment_method || null,
        note: iuranRecords[0].note || null,
        recordedBy: {
          id: recorderInfo?._id?.toString() || "",
          username: recorderInfo?.username || "Unknown",
        },
      };

      const receiptPdfUrl = await generateReceiptPDF(receiptData);

      return response.success(
        res,
        {
          receiptPdfUrl: receiptPdfUrl,
          receipt: receiptData,
        },
        "Receipt generated successfully"
      );
    } catch (error) {
      console.error("Generate receipt error:", error);
      response.error(res, error, "failed to generate receipt");
      return;
    }
  },
  async createYearlyIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { year } = req.body;

      if (!year) {
        response.error(res, "year is required", "validation error");
        return;
      }

      const targetYear = Number(year);
      if (isNaN(targetYear) || targetYear < 2020 || targetYear > 2100) {
        response.error(
          res,
          "invalid year. Must be between 2020 and 2100",
          "validation error"
        );
        return;
      }

      // Get all users except ADMIN
      const users = await userModel.find({ role: { $ne: ROLES.ADMIN } });

      if (users.length === 0) {
        response.error(
          res,
          "no users found to create iuran",
          "validation error"
        );
        return;
      }

      let totalCreated = 0;
      let totalSkipped = 0;
      const userResults = [];

      // Create iuran for each user
      for (const user of users) {
        const iuranPromises = [];
        const createdPeriods = [];
        const skippedPeriods = [];

        for (let month = 1; month <= 12; month++) {
          const period = `${targetYear}-${String(month).padStart(2, "0")}`;

          const existingIuran = await iuranModel.findOne({
            user: user._id,
            period: period,
            type: "regular",
          });

          if (existingIuran) {
            skippedPeriods.push(period);
            totalSkipped++;
            continue;
          }

          iuranPromises.push(
            iuranModel.create({
              user: user._id,
              period: period,
              amount: "50000",
              type: "regular",
              status: IURAN_STATUS.UNPAID,
              submitted_at: null,
              confirmed_at: null,
              confirmed_by: null,
            })
          );
          createdPeriods.push(period);
          totalCreated++;
        }

        await Promise.all(iuranPromises);

        userResults.push({
          userId: user._id,
          username: user.username,
          created: createdPeriods.length,
          skipped: skippedPeriods.length,
        });
      }

      return response.success(
        res,
        {
          year: targetYear,
          totalUsers: users.length,
          totalCreated,
          totalSkipped,
          userResults,
        },
        `Successfully created ${totalCreated} iuran record(s) for ${users.length} user(s)`
      );
    } catch (error) {
      console.log(error, "check error");
      response.error(res, error, "failed to create yearly iuran");
      return;
    }
  },
  async downloadTemplate(req: IReqUser, res: Response): Promise<void> {
    try {
      const buffer = await createIuranImportTemplate();

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=template_import_iuran.xlsx"
      );

      res.send(buffer);
    } catch (error) {
      response.error(res, error, "failed to generate template");
      return;
    }
  },
  async importIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      const adminId = req.user?.id;
      if (!adminId) {
        response.unauthorized(res, "unauthorized");
        return;
      }

      const file = req.file;
      if (!file) {
        response.error(res, "file is required", "validation error");
        return;
      }

      console.log("Import file received:", {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.buffer?.length || "disk storage",
        path: (file as any).path,
      });

      // Get file buffer - either from memory or read from disk
      let fileBuffer: Buffer;
      if (file.buffer) {
        fileBuffer = file.buffer;
      } else if ((file as any).path) {
        // File is stored on disk, read it
        fileBuffer = fs.readFileSync((file as any).path);
        // Clean up the temp file after reading
        fs.unlinkSync((file as any).path);
      } else {
        response.error(res, "Unable to read uploaded file", "file error");
        return;
      }

      // Parse Excel file
      let importData;
      try {
        importData = await parseIuranImportFile(fileBuffer);
        console.log("=== PARSED DATA SUMMARY ===");
        console.log("Total rows parsed:", importData.length);
        importData.slice(0, 5).forEach((row, i) => {
          console.log(`Row ${i + 1}: nama="${row.nama}", alamat="${row.alamat}", start="${row.start}", payments=${row.payments.length}`);
        });
        console.log("All names:", importData.map(r => r.nama).join(", "));
      } catch (parseError: any) {
        console.error("Parse error:", parseError);
        response.error(
          res,
          `Failed to parse Excel file: ${parseError.message}. Make sure the file is .xlsx format (not .xls)`,
          "parse error"
        );
        return;
      }

      if (importData.length === 0) {
        response.error(res, "no data found in file", "validation error");
        return;
      }

      // Check if user wants to clear previous imported data
      const clearPrevious = req.query.clear === "true";
      if (clearPrevious) {
        // Delete all previously imported iuran
        const deleteResult = await iuranModel.deleteMany({ is_imported: true });
        console.log(`Cleared ${deleteResult.deletedCount} previously imported iuran records`);
      }

      const results = {
        totalRows: importData.length,
        usersCreated: 0,
        usersFound: 0,
        iuranCreated: 0,
        errors: [] as string[],
        processedUsers: [] as string[],
      };

      // Helper function to parse various date formats to year/month
      const parseStartDate = (
        startValue: any
      ): { year: number; month: number } | null => {
        const monthNameToNumber: { [key: string]: number } = {
          jan: 1, feb: 2, mar: 3, apr: 4,
          may: 5, jun: 6, jul: 7, aug: 8,
          sep: 9, oct: 10, nov: 11, dec: 12,
        };

        // If it's a Date object (Excel date)
        if (startValue instanceof Date) {
          return {
            year: startValue.getFullYear(),
            month: startValue.getMonth() + 1,
          };
        }

        const startStr = String(startValue || "").trim();
        if (!startStr) return null;

        // Try "Jan-21" format
        const match1 = startStr.match(/^([A-Za-z]{3})-(\d{2})$/);
        if (match1) {
          const monthName = match1[1].toLowerCase();
          const yearShort = parseInt(match1[2]);
          const monthNum = monthNameToNumber[monthName];
          if (monthNum) {
            const year = yearShort < 50 ? 2000 + yearShort : 1900 + yearShort;
            return { year, month: monthNum };
          }
        }

        // Try "Jan-2021" format
        const match2 = startStr.match(/^([A-Za-z]{3})-(\d{4})$/);
        if (match2) {
          const monthName = match2[1].toLowerCase();
          const monthNum = monthNameToNumber[monthName];
          if (monthNum) {
            return { year: parseInt(match2[2]), month: monthNum };
          }
        }

        // Try "2021-01" format
        const match3 = startStr.match(/^(\d{4})-(\d{2})$/);
        if (match3) {
          return { year: parseInt(match3[1]), month: parseInt(match3[2]) };
        }

        // Try parsing as date string
        const dateAttempt = new Date(startStr);
        if (!isNaN(dateAttempt.getTime())) {
          return {
            year: dateAttempt.getFullYear(),
            month: dateAttempt.getMonth() + 1,
          };
        }

        return null;
      };

      // Helper function to generate periods from start to end
      const generatePeriods = (
        startYear: number,
        startMonth: number,
        endYear: number,
        endMonth: number
      ): string[] => {
        const periods: string[] = [];
        let year = startYear;
        let month = startMonth;
        while (year < endYear || (year === endYear && month <= endMonth)) {
          periods.push(`${year}-${String(month).padStart(2, "0")}`);
          month++;
          if (month > 12) {
            month = 1;
            year++;
          }
        }
        return periods;
      };

      // End period: December of current year
      const now = new Date();
      const currentYear = now.getFullYear();
      const endMonth = 12; // Always create until December

      // Get all existing users for matching
      const allUsers = await userModel.find({}).lean();

      // Create lookup maps - by name only and by name+address
      const userMapByName: { [key: string]: any } = {};
      const userMapByNameAndAddress: { [key: string]: any } = {};

      allUsers.forEach((user) => {
        const nameLower = user.username.toLowerCase();
        const addressLower = (user.address || "").toLowerCase().trim();

        // Map by name only (for backward compatibility)
        userMapByName[nameLower] = user;

        // Map by name + address (for unique matching)
        const nameAddressKey = `${nameLower}|${addressLower}`;
        userMapByNameAndAddress[nameAddressKey] = user;
      });

      // Default amount for iuran
      const DEFAULT_AMOUNT = "50000";

      for (const row of importData) {
        try {
          const nameLower = row.nama.toLowerCase();
          const addressLower = (row.alamat || "").toLowerCase().trim();
          const nameAddressKey = `${nameLower}|${addressLower}`;

          // Try to find by name + address first (more specific)
          // Then fallback to name only if address matches or user has no address
          let user = userMapByNameAndAddress[nameAddressKey];

          if (!user) {
            // Check if there's a user with same name
            const userByName = userMapByName[nameLower];
            if (userByName) {
              // If user has no address or address matches, use this user
              const existingAddress = (userByName.address || "").toLowerCase().trim();
              if (!existingAddress || existingAddress === addressLower) {
                user = userByName;
              }
              // Otherwise, user with same name but different address = different person
            }
          }

          console.log(`Looking for: "${row.nama}" at "${row.alamat}" -> found: ${!!user}`);

          if (!user) {
            // Create new user
            const username = row.nama
              .toLowerCase()
              .replace(/\s+/g, "_")
              .replace(/[^a-z0-9_]/g, "");
            const email = `${username}@warga.rt`;

            // Check if email already exists (edge case)
            const existingEmail = await userModel.findOne({
              email: { $regex: new RegExp(`^${email}$`, "i") },
            });

            const finalEmail = existingEmail
              ? `${username}_${Date.now()}@warga.rt`
              : email;

            const newUser = await userModel.create({
              email: finalEmail,
              username: row.nama,
              password: "password123",
              role: ROLES.WARGA,
              address: row.alamat || null,
              phone_number: null,
              image_url: null,
            });

            user = newUser;
            // Add to both maps for future lookups in same import
            userMapByName[nameLower] = user;
            userMapByNameAndAddress[nameAddressKey] = user;
            results.usersCreated++;
          } else {
            results.usersFound++;

            // Update address if provided and user has no address
            if (row.alamat && !user.address) {
              await userModel.findByIdAndUpdate(user._id, {
                address: row.alamat,
              });
            }
          }

          // Track processed users
          results.processedUsers.push(row.nama);

          // Parse start date
          console.log(`Row ${row.no} (${row.nama}): start value =`, row.start, `type =`, typeof row.start);
          const startDate = parseStartDate(row.start);
          if (!startDate) {
            results.errors.push(
              `Row ${row.no} (${row.nama}): Invalid start date format "${row.start}" (type: ${typeof row.start})`
            );
            continue;
          }
          console.log(`Row ${row.no} (${row.nama}): parsed to`, startDate);

          // Generate all periods from start date to December of current year
          const allPeriods = generatePeriods(
            startDate.year,
            startDate.month,
            currentYear,
            endMonth
          );

          // Create a map of paid periods from Excel (cells with values)
          const paidPeriodsMap: { [period: string]: number } = {};
          for (const payment of row.payments) {
            paidPeriodsMap[payment.period] = payment.amount;
          }

          // Delete ALL existing iuran for this user in the period range (clean slate for this user)
          // This ensures no duplicates and import data takes precedence
          const deleteResult = await iuranModel.deleteMany({
            user: user._id,
            period: { $in: allPeriods },
          });
          console.log(`Deleted ${deleteResult.deletedCount} existing iuran for ${row.nama} (user._id: ${user._id})`);

          // Create iuran for each period
          for (const period of allPeriods) {
            const isPaid = paidPeriodsMap.hasOwnProperty(period);

            // Create new iuran
            if (isPaid) {
              // Create as PAID (is_imported: true so it won't be counted in balance)
              await iuranModel.create({
                user: user._id,
                period: period,
                amount: DEFAULT_AMOUNT,
                status: IURAN_STATUS.PAID,
                type: "regular",
                confirmed_at: new Date(),
                confirmed_by: adminId,
                recorded_by: adminId,
                payment_date: new Date(),
                note: "Imported from Excel",
                is_imported: true,
              });
            } else {
              // Create as UNPAID (is_imported: true for tracking purposes)
              await iuranModel.create({
                user: user._id,
                period: period,
                amount: DEFAULT_AMOUNT,
                status: IURAN_STATUS.UNPAID,
                type: "regular",
                is_imported: true,
              });
            }
            results.iuranCreated++;
          }
        } catch (rowError: any) {
          results.errors.push(`Row ${row.no} (${row.nama}): ${rowError.message}`);
        }
      }

      return response.success(
        res,
        results,
        `Import completed: ${results.usersCreated} users created, ${results.usersFound} users found, ${results.iuranCreated} iuran created`
      );
    } catch (error) {
      console.error("Import iuran error:", error);
      response.error(res, error, "failed to import iuran");
      return;
    }
  },
  async exportIuran(req: IReqUser, res: Response): Promise<void> {
    try {
      const { startYear = 2020, endYear = new Date().getFullYear() + 1 } =
        req.query;

      // Get all non-admin users
      const users = await userModel
        .find({ role: { $ne: ROLES.ADMIN } })
        .sort({ username: 1 })
        .lean();

      // Get all iuran records within the year range
      const startPeriod = `${startYear}-01`;
      const endPeriod = `${endYear}-12`;

      const iuranRecords = await iuranModel
        .find({
          period: { $gte: startPeriod, $lte: endPeriod },
        })
        .lean();

      // Create a map of user iuran: userId -> period -> iuran
      const iuranMap: { [userId: string]: { [period: string]: any } } = {};
      iuranRecords.forEach((iuran: any) => {
        const uId = iuran.user.toString();
        if (!iuranMap[uId]) {
          iuranMap[uId] = {};
        }
        iuranMap[uId][iuran.period] = iuran;
      });

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Data Iuran");

      // Generate month columns
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];

      const monthColumns: { header: string; key: string; width: number }[] = [];
      for (let y = Number(startYear); y <= Number(endYear); y++) {
        for (let m = 1; m <= 12; m++) {
          const key = `${y}-${String(m).padStart(2, "0")}`;
          const header = `${monthNames[m - 1]}-${String(y).slice(-2)}`;
          monthColumns.push({ header, key, width: 10 });
        }
      }

      // Define columns
      worksheet.columns = [
        { header: "No", key: "no", width: 6 },
        { header: "Nama", key: "nama", width: 20 },
        { header: "Alamat", key: "alamat", width: 15 },
        { header: "Start", key: "start", width: 10 },
        ...monthColumns,
      ];

      // Style header row
      worksheet.getRow(1).font = {
        bold: true,
        size: 11,
        color: { argb: "FFFFFFFF" },
      };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF000000" },
      };
      worksheet.getRow(1).alignment = {
        vertical: "middle",
        horizontal: "center",
      };

      // Add data rows
      users.forEach((user, index) => {
        const rowData: any = {
          no: index + 1,
          nama: user.username,
          alamat: user.address || "",
          start: "",
        };

        const userIuran = iuranMap[user._id.toString()] || {};

        // Find earliest paid period as "Start"
        const paidPeriods = Object.entries(userIuran)
          .filter(([_, iuran]: [string, any]) => iuran.status === IURAN_STATUS.PAID)
          .map(([period]) => period)
          .sort();

        if (paidPeriods.length > 0) {
          const firstPeriod = paidPeriods[0];
          const [y, m] = firstPeriod.split("-");
          rowData.start = `${monthNames[parseInt(m) - 1]}-${y.slice(-2)}`;
        }

        // Add payment data for each month
        monthColumns.forEach((col) => {
          const iuran = userIuran[col.key];
          if (iuran && iuran.status === IURAN_STATUS.PAID) {
            rowData[col.key] = Number(iuran.amount);
          }
        });

        const row = worksheet.addRow(rowData);

        // Highlight paid cells with green background
        monthColumns.forEach((col, colIndex) => {
          const iuran = userIuran[col.key];
          if (iuran && iuran.status === IURAN_STATUS.PAID) {
            const cell = row.getCell(5 + colIndex); // 5 = offset for No, Nama, Alamat, Start columns
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FF90EE90" }, // Light green
            };
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=export_iuran_${new Date().toISOString().split("T")[0]}.xlsx`
      );

      res.send(buffer);
    } catch (error) {
      console.error("Export iuran error:", error);
      response.error(res, error, "failed to export iuran");
      return;
    }
  },
};
