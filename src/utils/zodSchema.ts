import { z } from "zod";
import { ROLES } from "./constants";

export const UserDTO = z.object({
  email: z.email().min(1, "Email is required"),
  username: z.string().min(5, "Name length min 5"),
  password: z.string().min(8, "Password length min 8"),
  role: z.enum([ROLES.ADMIN, ROLES.RT, ROLES.RW, ROLES.SATPAM, ROLES.WARGA, ROLES.BENDAHARA]),
  address: z.string().optional(),
  phone_number: z
    .string()
    .regex(/^[0-9]+$/, "Phone number must contain only numbers")
    .min(10, "Phone number too short")
    .max(15, "Phone number too long")
    .optional(),
  image_url: z.string().optional(),
});

export const UserLoginDTO = z.object({
  identifier: z.string().min(5, "Please input email/username"),
  password: z.string().min(5, "Please input password"),
});

export const UpdatePasswordDTO = z.object({
  password: z.string().min(8, "Password length min 8"),
});

export const IuranDTO = z.object({
  user: z.string(),
  period: z.string(),
  amount: z.string(),
  status: z.string(),
  proof_image_url: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  submitted_at: z.string().optional().nullable(),
  confirmed_at: z.string().optional().nullable(),
  confirmed_by: z.string().optional().nullable(),
});

export const IuranSubmitWargaDTO = z.object({
  period: z.string().min(1, "Period date is required"),
  amount: z.string().min(1, "Amount is required"),
});
