import mongoose from "mongoose";
import pengeluaranModel from "../models/pengeluaran.model";
import eventModel from "../models/event.model";
import dotenv from "dotenv";

dotenv.config();

async function linkPengeluaranToEvents() {
  try {
    const mongoUri =
      process.env.MONGO_URI || "mongodb://localhost:27017/rt-db";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Get all completed events
    const completedEvents = await eventModel
      .find({ status: "completed" })
      .lean();
    console.log(`Found ${completedEvents.length} completed events`);

    // Get all pengeluaran without event_id
    const pengeluaranWithoutEventId = await pengeluaranModel.find({
      $or: [{ event_id: { $exists: false } }, { event_id: null }],
    });

    console.log(
      `Found ${pengeluaranWithoutEventId.length} pengeluaran without event_id`
    );

    if (pengeluaranWithoutEventId.length === 0) {
      console.log("All pengeluaran already have event_id or are manual!");
      await mongoose.connection.close();
      return;
    }

    let linkedCount = 0;
    let skippedCount = 0;

    for (const pengeluaran of pengeluaranWithoutEventId) {
      // Try to find matching event based on title pattern: "{event.name} - {expense.description}"
      let matchedEvent = null;

      for (const event of completedEvents) {
        // Check if pengeluaran title starts with event name followed by " - "
        if (pengeluaran.title.startsWith(`${event.name} - `)) {
          matchedEvent = event;
          break;
        }
      }

      if (matchedEvent) {
        await pengeluaranModel.findByIdAndUpdate(pengeluaran._id, {
          event_id: matchedEvent._id,
        });
        console.log(
          `Linked pengeluaran "${pengeluaran.title}" to event "${matchedEvent.name}"`
        );
        linkedCount++;
      } else {
        // This is likely a manual pengeluaran (not from event)
        console.log(
          `Skipped pengeluaran "${pengeluaran.title}" - no matching event found (manual pengeluaran)`
        );
        skippedCount++;
      }
    }

    console.log("\n=== Migration Summary ===");
    console.log(`Total pengeluaran processed: ${pengeluaranWithoutEventId.length}`);
    console.log(`Linked to events: ${linkedCount}`);
    console.log(`Skipped (manual pengeluaran): ${skippedCount}`);

    await mongoose.connection.close();
    console.log("\nDatabase connection closed");
  } catch (error) {
    console.error("Error linking pengeluaran to events:", error);
    process.exit(1);
  }
}

linkPengeluaranToEvents();
