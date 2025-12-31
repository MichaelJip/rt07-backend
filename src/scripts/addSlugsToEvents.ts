import mongoose from "mongoose";
import eventModel from "../models/event.model";
import { generateSlug, generateUniqueSlug } from "../utils/slugGenerator";

async function addSlugsToEvents() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/rt-db";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Find all events without slugs
    const eventsWithoutSlugs = await eventModel.find({
      $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
    });

    console.log(`Found ${eventsWithoutSlugs.length} events without slugs`);

    if (eventsWithoutSlugs.length === 0) {
      console.log("All events already have slugs!");
      await mongoose.disconnect();
      return;
    }

    // Get all existing slugs to ensure uniqueness
    const allEvents = await eventModel.find({ slug: { $exists: true, $ne: null } }).select("slug").lean();
    const existingSlugs = allEvents.map((e) => e.slug).filter((s) => s);

    // Add slugs to events
    for (const event of eventsWithoutSlugs) {
      const baseSlug = generateSlug(event.name);
      const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs);

      // Update the event
      event.slug = uniqueSlug;
      await event.save();

      // Add to existing slugs to maintain uniqueness
      existingSlugs.push(uniqueSlug);

      console.log(`✓ Added slug "${uniqueSlug}" to event "${event.name}"`);
    }

    console.log("\n✅ Migration completed successfully!");
    console.log(`Updated ${eventsWithoutSlugs.length} events`);

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the migration
addSlugsToEvents();
