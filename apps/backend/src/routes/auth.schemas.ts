import { z } from "zod";

const passwordStrength = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,64}$/;

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z
    .string()
    .regex(
      passwordStrength,
      "Password must be 10-64 chars and include upper, lower, number, and special character."
    )
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(64)
});
