import fs from "fs";
import path from "path";

/**
 * Script to clear all files in the uploads directory
 * Usage: npm run clear-uploads
 */

const uploadsDir = path.join(process.cwd(), "uploads");

function clearUploads() {
  try {
    // Check if uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      console.log("✓ Uploads directory does not exist - nothing to clear");
      return;
    }

    // Read all files in uploads directory
    const files = fs.readdirSync(uploadsDir);

    if (files.length === 0) {
      console.log("✓ Uploads directory is already empty");
      return;
    }

    console.log(`Found ${files.length} file(s) in uploads directory`);

    let deletedCount = 0;
    let errorCount = 0;

    // Delete each file
    files.forEach((file) => {
      const filePath = path.join(uploadsDir, file);

      try {
        // Check if it's a file (not a directory)
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          fs.unlinkSync(filePath);
          console.log(`  - Deleted: ${file}`);
          deletedCount++;
        } else {
          console.log(`  - Skipped (not a file): ${file}`);
        }
      } catch (error) {
        console.error(`  ✗ Error deleting ${file}:`, error);
        errorCount++;
      }
    });

    console.log("\n=== Summary ===");
    console.log(`✓ Deleted: ${deletedCount} file(s)`);
    if (errorCount > 0) {
      console.log(`✗ Errors: ${errorCount} file(s)`);
    }
    console.log("✓ Upload directory cleared successfully");
  } catch (error) {
    console.error("✗ Failed to clear uploads directory:", error);
    process.exit(1);
  }
}

// Run the script
clearUploads();
