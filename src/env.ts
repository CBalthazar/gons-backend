import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default("/api/v1"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be >= 32 chars"),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().default("gons.refresh"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  MAX_MODEL_BYTES: z.coerce.number().int().positive().default(52_428_800),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("eu-west-1"),
  S3_BUCKET: z.string().default("gons-models"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  SIGNED_URL_TTL: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", z.treeifyError(parsed.error));
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const corsOrigins = (env: Env): string[] =>
  env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
