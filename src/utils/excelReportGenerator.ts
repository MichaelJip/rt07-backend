import ExcelJS from "exceljs";
import { Event } from "../models/event.model";

interface CategoryExpense {
  category: string;
  items: {
    name: string;
    cost: number;
  }[];
  note?: string;
}

export async function generateEventReport(
  event: Event,
  totalSumbangan: number
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Laporan Event");

  // Set column widths
  worksheet.columns = [
    { key: "A", width: 15 }, // KAT
    { key: "B", width: 40 }, // ITEM
    { key: "C", width: 20 }, // BIAYA
    { key: "D", width: 20 }, // SUB TOTAL
    { key: "E", width: 30 }, // KET
  ];

  // Header Row
  const headerRow = worksheet.addRow([
    "KAT",
    "ITEM",
    "BIAYA",
    "SUB TOTAL",
    "KET",
  ]);

  headerRow.font = { bold: true, size: 12 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFF00" }, // Yellow
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Group expenses by category
  const categories = groupExpensesByCategory(event);

  let currentRow = 2;

  // Process each category
  categories.forEach((category) => {
    const categoryStartRow = currentRow;
    const categoryColor = getCategoryColor(category.category);

    // Add items for this category
    category.items.forEach((item) => {
      const row = worksheet.addRow([
        "", // KAT (will be merged later)
        item.name,
        item.cost,
        "", // SUB TOTAL (will be merged later)
        "",
      ]);

      // Set category color background for item rows
      row.eachCell((cell, colNumber) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: categoryColor },
        };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };

        // Format currency
        if (colNumber === 3) {
          cell.numFmt = "#,##0";
          cell.alignment = { horizontal: "right" };
        }
      });

      currentRow++;
    });

    const categoryEndRow = currentRow - 1;

    // Merge KAT column for category
    worksheet.mergeCells(`A${categoryStartRow}:A${categoryEndRow}`);
    const categoryCell = worksheet.getCell(`A${categoryStartRow}`);
    categoryCell.value = category.category;
    categoryCell.font = { bold: true, size: 11 };
    categoryCell.alignment = { horizontal: "center", vertical: "middle" };
    categoryCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: categoryColor },
    };

    // Merge SUB TOTAL column for category
    worksheet.mergeCells(`D${categoryStartRow}:D${categoryEndRow}`);
    const subTotalCell = worksheet.getCell(`D${categoryStartRow}`);

    // Calculate subtotal using Excel formula
    const sumRange = `C${categoryStartRow}:C${categoryEndRow}`;
    subTotalCell.value = { formula: `SUM(${sumRange})` };
    subTotalCell.font = { bold: true, size: 11 };
    subTotalCell.numFmt = "#,##0";
    subTotalCell.alignment = { horizontal: "right", vertical: "middle" };
    subTotalCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: categoryColor },
    };

    // Merge KET column for category note
    if (category.note) {
      worksheet.mergeCells(`E${categoryStartRow}:E${categoryEndRow}`);
      const noteCell = worksheet.getCell(`E${categoryStartRow}`);
      noteCell.value = category.note;
      noteCell.alignment = { horizontal: "left", vertical: "middle" };
      noteCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: categoryColor },
      };
    }
  });

  // Add TOTAL PENGELUARAN row
  const totalPengeluaranRow = worksheet.addRow([
    "",
    "TOTAL PENGELUARAN",
    { formula: `SUM(C2:C${currentRow - 1})` },
    { formula: `SUM(D2:D${currentRow - 1})` },
    "",
  ]);
  totalPengeluaranRow.font = { bold: true, size: 12 };
  totalPengeluaranRow.eachCell((cell, colNumber) => {
    if (colNumber === 3 || colNumber === 4) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right" };
    }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFFFF" }, // White
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
  currentRow++;

  // Add TOTAL SUMBANGAN row
  const totalSumbanganRow = worksheet.addRow([
    "",
    `TOTAL SUMBANGAN ${event.name.toUpperCase()}`,
    totalSumbangan,
    totalSumbangan,
    "",
  ]);
  totalSumbanganRow.font = { bold: true, size: 12 };
  totalSumbanganRow.eachCell((cell, colNumber) => {
    if (colNumber === 3 || colNumber === 4) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right" };
    }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFADD8E6" }, // Light blue
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });
  currentRow++;

  // Add DANA KAS row
  const danaKasRow = worksheet.addRow([
    "",
    `DANA KAS UNTUK ${event.name.toUpperCase()}`,
    { formula: `C${currentRow - 1}-C${currentRow - 2}` },
    { formula: `D${currentRow - 1}-D${currentRow - 2}` },
    "",
  ]);
  danaKasRow.font = { bold: true, size: 12 };
  danaKasRow.eachCell((cell, colNumber) => {
    if (colNumber === 3 || colNumber === 4) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right" };
    }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFADD8E6" }, // Light blue
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

function groupExpensesByCategory(event: Event): CategoryExpense[] {
  const categoryMap: { [key: string]: CategoryExpense } = {
    HIBURAN: { category: "HIBURAN", items: [] },
    LOMBA: { category: "LOMBA", items: [] },
    KONSUMSI: { category: "KONSUMSI", items: [] },
    LAINNYA: { category: "LAINNYA", items: [] },
  };

  // Group expenses by their category field
  event.expenses.forEach((expense) => {
    const item = {
      name: expense.description,
      cost: Number(expense.amount),
    };

    const categoryKey = expense.category || "LAINNYA";
    if (categoryMap[categoryKey]) {
      categoryMap[categoryKey].items.push(item);
    }
  });

  // Return only categories that have items
  const categories: CategoryExpense[] = [];
  const categoryOrder = ["HIBURAN", "LOMBA", "KONSUMSI", "LAINNYA"];

  categoryOrder.forEach((key) => {
    if (categoryMap[key].items.length > 0) {
      categories.push(categoryMap[key]);
    }
  });

  return categories;
}

function getCategoryColor(category: string): string {
  const colors: { [key: string]: string } = {
    HIBURAN: "FFADD8E6", // Light blue
    LOMBA: "FFFFC0CB", // Light pink
    KONSUMSI: "FFCCFFCC", // Light green
    LAINNYA: "FFFFFFE0", // Light yellow
  };

  return colors[category] || "FFFFFFFF"; // White as default
}
