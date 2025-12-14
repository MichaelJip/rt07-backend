import connect from "../utils/database";
import iuranModel from "../models/iuran.model";

async function dropUniqueIndex() {
  try {
    await connect();
    console.log("Connected to database");

    // Get all indexes
    const indexes = await iuranModel.collection.getIndexes();
    console.log("Current indexes:", indexes);

    // Drop the old unique index if it exists
    try {
      await iuranModel.collection.dropIndex("user_1_period_1");
      console.log("✅ Successfully dropped unique index: user_1_period_1");
    } catch (error: any) {
      if (error.code === 27) {
        console.log("Index user_1_period_1 does not exist, skipping...");
      } else {
        throw error;
      }
    }

    // Recreate the non-unique index
    await iuranModel.collection.createIndex(
      { user: 1, period: 1 },
      { unique: false }
    );
    console.log("✅ Created non-unique index: user_1_period_1");

    // Show final indexes
    const finalIndexes = await iuranModel.collection.getIndexes();
    console.log("Final indexes:", finalIndexes);

    console.log("\n✅ Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

dropUniqueIndex();
