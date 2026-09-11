import { z } from "zod";

export const registerSchema = z.object({
  email: z.email().max(255),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9._-]+$/, "Invalid username"),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  identifier: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
});

export const forgotSchema = z.object({
  email: z.email(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
