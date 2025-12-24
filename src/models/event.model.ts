import mongoose, { Types } from "mongoose";
import { USER_MODEL_NAME } from "./user.model";

export const EVENT_MODEL_NAME = "Event";

export interface Donation {
  donor_name: string;
  amount: string;
  date: Date;
}

export interface EventExpense {
  description: string;
  amount: string;
  date: Date;
  proof_image_urls?: string[];
}

export interface Event {
  name: string;
  description: string;
  date: Date;
  donations: Donation[];
  expenses: EventExpense[];
  total_donations: string;
  total_expenses: string;
  balance: string; // positive = surplus, negative = deficit
  status: "planning" | "active" | "completed";
  completed_at?: Date | null;
  created_by: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const Schema = mongoose.Schema;

const DonationSchema = new Schema({
  donor_name: {
    type: String,
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const EventExpenseSchema = new Schema({
  description: {
    type: String,
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  proof_image_urls: {
    type: [String],
    default: [],
  },
});

const eventSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    donations: {
      type: [DonationSchema],
      default: [],
    },
    expenses: {
      type: [EventExpenseSchema],
      default: [],
    },
    total_donations: {
      type: String,
      default: "0",
    },
    total_expenses: {
      type: String,
      default: "0",
    },
    balance: {
      type: String,
      default: "0",
    },
    status: {
      type: String,
      enum: ["planning", "active", "completed"],
      default: "planning",
    },
    completed_at: {
      type: Date,
      default: null,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: USER_MODEL_NAME,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Calculate totals before saving
eventSchema.pre("save", async function () {
  const totalDonations = this.donations.reduce(
    (sum, d) => sum + Number(d.amount),
    0
  );
  const totalExpenses = this.expenses.reduce(
    (sum, e) => sum + Number(e.amount),
    0
  );

  this.total_donations = String(totalDonations);
  this.total_expenses = String(totalExpenses);
  this.balance = String(totalDonations - totalExpenses);
});

const eventModel = mongoose.model<Event>(EVENT_MODEL_NAME, eventSchema);

export default eventModel;
