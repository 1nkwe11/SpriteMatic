import { logger, logSession } from "./observability/logger.js";
import { startSpriteWorker } from "./queue/sprite.queue.js";

startSpriteWorker();
logger.info("queue_worker_started", {
  logSessionId: logSession.id,
  logDirectory: logSession.directory
});

const shutdown = async (signal: string) => {
  logger.info("queue_worker_shutdown", { signal });
  await logger.close();
  process.exit(0);
};

process.on("unhandledRejection", (reason) => {
  logger.error("queue_worker_unhandled_rejection", { reason });
});

process.on("uncaughtException", (error) => {
  logger.error("queue_worker_uncaught_exception", { error });
  void shutdown("uncaughtException");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
