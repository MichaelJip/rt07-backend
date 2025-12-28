import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

interface ReceiptData {
  receiptNumber: string;
  receiptDate: Date;
  paymentDate: Date;
  user: {
    id: string;
    username: string;
    email: string;
  };
  periods: string[];
  amountPerPeriod: number;
  totalPeriods: number;
  totalAmount: number;
  paymentMethod: string | null;
  note: string | null;
  recordedBy: {
    id: string;
    username: string;
  };
}

export const generateReceiptPDF = (
  receiptData: ReceiptData
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      // Create receipts directory if it doesn't exist
      const receiptsDir = path.join(process.cwd(), "receipts");
      if (!fs.existsSync(receiptsDir)) {
        fs.mkdirSync(receiptsDir, { recursive: true });
      }

      const fileName = `${receiptData.receiptNumber}.pdf`;
      const filePath = path.join(receiptsDir, fileName);

      // Create PDF document
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const stream = fs.createWriteStream(filePath);

      doc.pipe(stream);

      // Header
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text("BUKTI PEMBAYARAN IURAN", { align: "center" })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("RT/RW Management System", { align: "center" })
        .moveDown(2);

      // Receipt Number and Date
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`No. Kwitansi: ${receiptData.receiptNumber}`, { align: "left" })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          `Tanggal Kwitansi: ${new Date(
            receiptData.receiptDate
          ).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}`,
          { align: "left" }
        )
        .text(
          `Tanggal Pembayaran: ${new Date(
            receiptData.paymentDate
          ).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}`,
          { align: "left" }
        )
        .moveDown(1.5);

      // Line separator
      doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(1);

      // User Information
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Informasi Warga", { underline: true })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Nama: ${receiptData.user.username}`)
        .text(`Email: ${receiptData.user.email}`)
        .moveDown(1.5);

      // Payment Details
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Rincian Pembayaran", { underline: true })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Periode yang dibayar:`)
        .moveDown(0.3);

      // List periods
      receiptData.periods.forEach((period, index) => {
        const periodDate = new Date(period + "-01");
        const formattedPeriod = periodDate.toLocaleDateString("id-ID", {
          month: "long",
          year: "numeric",
        });
        doc.text(
          `   ${index + 1}. ${formattedPeriod} - Rp ${receiptData.amountPerPeriod.toLocaleString(
            "id-ID"
          )}`
        );
      });

      doc.moveDown(1);

      // Line separator
      doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(0.5);

      // Total
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(
          `Jumlah Periode: ${receiptData.totalPeriods} bulan`,
          { align: "right" }
        )
        .fontSize(14)
        .text(
          `TOTAL: Rp ${receiptData.totalAmount.toLocaleString("id-ID")}`,
          { align: "right" }
        )
        .moveDown(1);

      // Line separator
      doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke()
        .moveDown(1);

      // Payment Method
      if (receiptData.paymentMethod) {
        doc
          .fontSize(10)
          .font("Helvetica")
          .text(`Metode Pembayaran: ${receiptData.paymentMethod}`)
          .moveDown(0.5);
      }

      // Note
      if (receiptData.note) {
        doc.text(`Catatan: ${receiptData.note}`).moveDown(1);
      }

      doc.moveDown(3);

      // Footer - Date (placed at current position, not absolute bottom)
      doc
        .fontSize(8)
        .font("Helvetica")
        .text(
          `Dokumen ini dibuat secara otomatis oleh sistem pada ${new Date().toLocaleString(
            "id-ID"
          )}`,
          50,
          doc.y,
          { align: "center", width: 500 }
        );

      // Finalize PDF
      doc.end();

      stream.on("finish", () => {
        resolve(`/receipts/${fileName}`);
      });

      stream.on("error", (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
};
