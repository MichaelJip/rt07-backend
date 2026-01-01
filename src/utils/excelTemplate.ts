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
