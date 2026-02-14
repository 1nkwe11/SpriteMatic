import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const configDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(configDir, "..", "..");
const configuredEnvPath = process.env.BACKEND_ENV_FILE?.trim();
const envFilePath = configuredEnvPath ? path.resolve(configuredEnvPath) : path.join(backendRoot, ".env");
dotenv.config({ path: envFilePath, override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_DIRECTORY: z.string().default("./logs"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ENABLE_TCPDUMP: booleanFromEnv.default(false),
  TCPDUMP_PATH: z.string().default("tcpdump"),
  TCPDUMP_INTERFACE: optionalTrimmedString,
  TCPDUMP_FILTER: optionalTrimmedString,
  TCPDUMP_EXTRA_ARGS: optionalTrimmedString,
  TCPDUMP_FILE_NAME: z.string().default("capture.pcap"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  START_WORKER_INLINE: booleanFromEnv.default(true),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(16).default(12),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  WANDB_API_KEY: optionalTrimmedString,
  OPENAI_FINE_TUNE_WANDB_PROJECT: optionalTrimmedString,
  OPENAI_FINE_TUNE_WANDB_ENTITY: optionalTrimmedString,
  OPENAI_FINE_TUNE_WANDB_TAGS: optionalTrimmedString,
  STRICT_QUALITY_GATE: booleanFromEnv.default(true),
  QUALITY_MIN_SCORE: z.coerce.number().min(50).max(100).default(85),
  QUALITY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
  MAX_ESTIMATED_GENERATION_COST_USD: z.coerce.number().positive().default(100),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  DAILY_DEFAULT_LIMIT: z.coerce.number().int().positive().default(50),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  CSRF_SECRET: z.string().min(16)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${formatted}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const resolvedEnvFilePath = envFilePath;
