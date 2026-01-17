import ExcelJS from "exceljs";
import { ROLES } from "./constants";

export async function createUserImportTemplate(): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Template Data
  const dataSheet = workbook.addWorksheet("Data Pengguna");

  // Define columns with Indonesian headers
  dataSheet.columns = [
    { header: "Email", key: "email", width: 30 },
    { header: "Nama Pengguna", key: "username", width: 20 },
    { header: "Peran", key: "role", width: 15 },
    { header: "Alamat", key: "address", width: 40 },
    { header: "No. Telepon", key: "phone_number", width: 18 },
  ];

  // Style header row
  dataSheet.getRow(1).font = { bold: true, size: 12 };
  dataSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  dataSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Add example row
  dataSheet.addRow({
    email: "contoh@email.com",
    username: "nama_pengguna",
    role: "warga",
    address: "Jl. Contoh No. 123",
    phone_number: "081234567890",
  });

  // Create dropdown list for roles
  const rolesList = [
    ROLES.ADMIN,
    ROLES.RT,
    ROLES.RW,
    ROLES.BENDAHARA,
    ROLES.SEKRETARIS,
    ROLES.SATPAM,
    ROLES.WARGA,
  ];

  // Add data validation for role column (Column C) for rows 2-1000
  for (let i = 2; i <= 1000; i++) {
    dataSheet.getCell(`C${i}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [`"${rolesList.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Peran tidak valid",
      error: "Silakan pilih peran dari dropdown yang tersedia",
    };
  }

  // Add data validation for email (basic format check)
  for (let i = 2; i <= 1000; i++) {
    dataSheet.getCell(`A${i}`).dataValidation = {
      type: "custom",
      allowBlank: false,
      formulae: ['ISNUMBER(FIND("@",A2))'],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Format Email",
      error: "Email harus mengandung karakter @",
    };
  }

  // Sheet 2: Instructions
  const instructionSheet = workbook.addWorksheet("Instruksi");
  instructionSheet.columns = [
    { header: "Panduan Penggunaan Template Import User", key: "instruction", width: 80 },
  ];

  instructionSheet.getRow(1).font = { bold: true, size: 14 };
  instructionSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF70AD47" },
  };

  const instructions = [
    "",
    "CARA PENGGUNAAN:",
    "1. Isi data pengguna pada sheet 'Data Pengguna'",
    "2. Email: Harus unik dan mengandung karakter @",
    "3. Nama Pengguna: Harus unik, tidak boleh sama dengan pengguna lain",
    "4. Peran: Pilih dari dropdown (admin, rt, rw, bendahara, sekretaris, satpam, warga)",
    "5. Alamat: Opsional, boleh dikosongkan",
    "6. No. Telepon: Format 10-15 digit angka (contoh: 081234567890)",
    "7. Password akan otomatis di-set menjadi 'password123' untuk semua user",
    "8. Foto profil tidak bisa di-import melalui Excel (opsional)",
    "",
    "CATATAN PENTING:",
    "- Jika email atau username sudah ada, user tersebut TIDAK akan dibuat ulang",
    "- Hapus baris contoh sebelum melakukan import",
    "- Pastikan semua data yang wajib diisi sudah lengkap",
    "- Sistem akan membuat iuran otomatis untuk user yang bukan admin",
    "",
    "DAFTAR PERAN:",
    "- admin: Administrator sistem",
    "- rt: Ketua RT",
    "- rw: Ketua RW",
    "- bendahara: Bendahara",
    "- sekretaris: Sekretaris",
    "- satpam: Satpam/Keamanan",
    "- warga: Warga biasa",
  ];

  instructions.forEach((instruction, index) => {
    const row = instructionSheet.addRow({ instruction });
    if (index === 1 || index === 11 || index === 18) {
      row.font = { bold: true, size: 12 };
    }
  });

  return await workbook.xlsx.writeBuffer();
}

export async function exportUsersToExcel(users: any[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Data Pengguna");

  // Define columns
  worksheet.columns = [
    { header: "Email", key: "email", width: 30 },
    { header: "Nama Pengguna", key: "username", width: 20 },
    { header: "Peran", key: "role", width: 15 },
    { header: "Alamat", key: "address", width: 40 },
    { header: "No. Telepon", key: "phone_number", width: 18 },
  ];

  // Style header
  worksheet.getRow(1).font = { bold: true, size: 12 };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Add data rows
  users.forEach((user) => {
    worksheet.addRow({
      email: user.email || "",
      username: user.username || "",
      role: user.role || "",
      address: user.address || "",
      phone_number: user.phone_number || "",
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate month columns from startYear-startMonth to endYear-endMonth
 */
function generateMonthColumns(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { header: string; key: string; width: number }[] {
  const columns: { header: string; key: string; width: number }[] = [];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const header = `${monthNames[month - 1]}-${String(year).slice(-2)}`;
    columns.push({ header, key, width: 10 });

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return columns;
}

export async function createIuranImportTemplate(): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Template Data
  const dataSheet = workbook.addWorksheet("Data Iuran");

  // Generate month columns from Jun-2020 to Dec-2030 (10+ years of data)
  const monthColumns = generateMonthColumns(2020, 6, 2030, 12);

  // Define columns
  const baseColumns = [
    { header: "No", key: "no", width: 6 },
    { header: "Nama", key: "nama", width: 20 },
    { header: "Alamat", key: "alamat", width: 15 },
    { header: "Start", key: "start", width: 10 },
  ];

  dataSheet.columns = [...baseColumns, ...monthColumns];

  // Style header row
  dataSheet.getRow(1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  dataSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF000000" },
  };
  dataSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Add example rows
  dataSheet.addRow({
    no: 1,
    nama: "Tommy",
    alamat: "AX7 No. 27",
    start: "Jan-21",
    "2021-02": 50000,
    "2021-03": 50000,
  });

  dataSheet.addRow({
    no: 2,
    nama: "Bram",
    alamat: "AX7 No. 31",
    start: "Jan-21",
    "2021-01": 50000,
    "2021-02": 50000,
    "2021-03": 50000,
  });

  // Sheet 2: Instructions
  const instructionSheet = workbook.addWorksheet("Instruksi");
  instructionSheet.columns = [
    { header: "Panduan Import Iuran", key: "instruction", width: 100 },
  ];

  instructionSheet.getRow(1).font = { bold: true, size: 14 };
  instructionSheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF70AD47" },
  };

  const instructions = [
    "",
    "CARA PENGGUNAAN:",
    "1. Isi data iuran pada sheet 'Data Iuran'",
    "2. No: Nomor urut (untuk referensi saja)",
    "3. Nama: Nama warga (PENTING: Pencocokan case-insensitive, 'Tommy' = 'tommy' = 'TOMMY')",
    "4. Alamat: Alamat warga (contoh: AX7 No. 27)",
    "5. Start: Bulan mulai tinggal/bayar iuran (format: Jan-21, Feb-22, dst)",
    "6. Kolom bulan (Jun-20, Jul-20, dst): Isi nominal jika sudah bayar, kosongkan jika belum",
    "",
    "ATURAN IMPORT:",
    "- Jika nama warga SUDAH ADA di sistem: Update data iuran saja",
    "- Jika nama warga BELUM ADA di sistem: Buat user baru dengan:",
    "  * Email: otomatis dari nama (contoh: tommy@warga.rt)",
    "  * Username: nama (lowercase, spasi jadi underscore)",
    "  * Password: password123 (default)",
    "  * Role: warga",
    "  * Address: dari kolom Alamat",
    "",
    "- Pencocokan nama adalah CASE-INSENSITIVE",
    "- Jika ada pembayaran di kolom bulan, status iuran akan menjadi 'paid'",
    "- Kolom yang kosong akan tetap 'unpaid'",
    "",
    "FORMAT BULAN:",
    "- Header kolom: MMM-YY (contoh: Jan-21, Feb-21, Mar-21)",
    "- Sistem akan menerjemahkan ke format YYYY-MM (contoh: 2021-01, 2021-02, 2021-03)",
    "",
    "CATATAN:",
    "- Hapus baris contoh sebelum import",
    "- Pastikan nama warga konsisten untuk menghindari duplikasi",
  ];

  instructions.forEach((instruction, index) => {
    const row = instructionSheet.addRow({ instruction });
    if (
      index === 1 ||
      index === 8 ||
      index === 21 ||
      index === 25
    ) {
      row.font = { bold: true, size: 12 };
    }
  });

  return await workbook.xlsx.writeBuffer();
}

export interface IuranImportData {
  no: number;
  nama: string;
  alamat: string;
  start: any; // Can be string, Date, or other Excel value
  payments: { period: string; amount: number }[];
}

export async function parseIuranImportFile(
  buffer: Buffer | ArrayBuffer
): Promise<IuranImportData[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);

  const worksheet = workbook.getWorksheet("Data Iuran") || workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Worksheet 'Data Iuran' tidak ditemukan");
  }

  const monthNameToNumber: { [key: string]: string } = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };

  // Parse header row to get month columns
  const headerRow = worksheet.getRow(1);
  const monthColumnMap: { [col: number]: string } = {};

  headerRow.eachCell((cell, colNumber) => {
    const cellValue = cell.value;

    // Debug first 10 headers
    if (colNumber <= 10) {
      console.log(`Header col ${colNumber}:`, cellValue, `type:`, typeof cellValue);
    }

    // Handle Date object (Excel date)
    if (cellValue instanceof Date) {
      const year = cellValue.getFullYear();
      const month = cellValue.getMonth() + 1;
      monthColumnMap[colNumber] = `${year}-${String(month).padStart(2, "0")}`;
      return;
    }

    // Handle string format "MMM-YY" (e.g., Jun-20, Jan-21)
    const header = String(cellValue || "").trim();
    const match = header.match(/^([A-Za-z]{3})-(\d{2})$/);
    if (match) {
      const monthName = match[1].toLowerCase();
      const yearShort = match[2];
      const monthNum = monthNameToNumber[monthName];
      if (monthNum) {
        const year = parseInt(yearShort) < 50 ? `20${yearShort}` : `19${yearShort}`;
        monthColumnMap[colNumber] = `${year}-${monthNum}`;
      }
    }
  });

  console.log("Month column map sample:", Object.entries(monthColumnMap).slice(0, 5));
  console.log("Total month columns found:", Object.keys(monthColumnMap).length);

  const results: IuranImportData[] = [];

  // Process data rows (skip header)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const no = Number(row.getCell(1).value) || rowNumber - 1;
    const nama = String(row.getCell(2).value || "").trim();
    const alamat = String(row.getCell(3).value || "").trim();
    const startRaw = row.getCell(4).value; // Keep raw value (can be Date or string)

    // Skip empty rows
    if (!nama) return;

    // Parse payments from month columns
    const payments: { period: string; amount: number }[] = [];

    Object.entries(monthColumnMap).forEach(([colStr, period]) => {
      const col = parseInt(colStr);
      const cell = row.getCell(col);
      const cellValue = cell.value;

      // Debug first row
      if (rowNumber === 2 && col <= 10) {
        console.log(`Cell [${rowNumber},${col}] period=${period}:`, {
          value: cellValue,
          type: typeof cellValue,
          text: cell.text,
        });
      }

      if (cellValue !== null && cellValue !== undefined && cellValue !== "") {
        const amount = typeof cellValue === "number"
          ? cellValue
          : parseFloat(String(cellValue).replace(/[^\d.,]/g, "").replace(",", "."));

        if (!isNaN(amount) && amount > 0) {
          payments.push({ period, amount });
        }
      }
    });

    results.push({
      no,
      nama,
      alamat,
      start: startRaw,
      payments,
    });
  });

  return results;
}
