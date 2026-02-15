import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { csrfProtection } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { apiRateLimit } from "./middleware/rate-limit.js";
import { logger } from "./observability/logger.js";
import { apiRouter } from "./routes/index.js";
import { authRouter } from "./routes/auth.routes.js";

export const app = express();
app.set("etag", false);

app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
const allowedOrigins = env.FRONTEND_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser clients
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    }
  })
);
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startNs = process.hrtime.bigint();
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    logger.http("http_request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(3)),
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      contentLength: res.getHeader("content-length") ?? null
    });
  });

  next();
});
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(apiRateLimit);
app.use(csrfProtection);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok"
  });
});

// Backward-compatible mount for clients calling "/auth/*" without the "/api" prefix
app.use("/auth", authRouter);

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
