import { app } from "./app.js";
import { env, resolvedEnvFilePath } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { logger, logSession } from "./observability/logger.js";
import { startPacketCapture } from "./observability/packet-capture.js";
import { startSpriteWorker } from "./queue/sprite.queue.js";
import { execSync } from "child_process";
import path from "path";
import express from "express";

const runMigrations = () => {
  try {
    const prismaDir = path.resolve(process.cwd(), "prisma");
    execSync("npx prisma migrate deploy", { stdio: "inherit", cwd: prismaDir });
    logger.info("prisma_migrate_deploy_ok", { prismaDir });
  } catch (error) {
    logger.error("prisma_migrate_deploy_failed", { error });
  }
};

runMigrations();

const adminToken = process.env.ADMIN_TOKEN;

if (adminToken) {
  app.post("/api/admin/run-migrations", express.json(), (_req, res) => {
    try {
      runMigrations();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error) });
    }
  });
}

const server = app.listen(env.PORT, () => {
  logger.info("api_server_started", {
    port: env.PORT,
    envFilePath: resolvedEnvFilePath,
    logSessionId: logSession.id,
    logDirectory: logSession.directory,
    appLogPath: logSession.appLogPath,
    errorLogPath: logSession.errorLogPath
  });
});
const packetCapture = startPacketCapture();

if (env.START_WORKER_INLINE) {
  startSpriteWorker();
  logger.info("inline_worker_started");
}

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown_requested", { signal });

  server.close(async () => {
    try {
      if (packetCapture) {
        await packetCapture.stop();
      }
      await prisma.$disconnect();
      await redis.quit();
      logger.info("shutdown_completed");
    } catch (error) {
      logger.error("shutdown_error", { error });
    } finally {
      await logger.close();
      process.exit(0);
    }
  });
};

server.on("error", (error) => {
  logger.error("api_server_error", { error });
});

process.on("unhandledRejection", (reason) => {
  logger.error("process_unhandled_rejection", { reason });
});

process.on("uncaughtException", (error) => {
  logger.error("process_uncaught_exception", { error });
  void shutdown("uncaughtException");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
