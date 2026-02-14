import { Queue, QueueEvents, Worker } from "bullmq";
import { env } from "../config/env.js";
import { processGeneration } from "../services/sprite.service.js";

const queueName = "sprite-generation";
const redisUrl = new URL(env.REDIS_URL);
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace("/", "") || 0) : 0,
  maxRetriesPerRequest: null as null
};

export const spriteQueue = new Queue(queueName, {
  connection: redisConnection
});

export const spriteQueueEvents = new QueueEvents(queueName, {
  connection: redisConnection
});

export const enqueueSpriteJob = async (generationId: string) =>
  spriteQueue.add(
    "generate",
    { generationId },
    {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000
      },
      removeOnComplete: 1000,
      removeOnFail: 1000
    }
  );

let worker: Worker | null = null;

export const startSpriteWorker = () => {
  if (worker) return worker;

  worker = new Worker(
    queueName,
    async (job) => {
      const generationId = (job.data as { generationId: string }).generationId;
      await processGeneration(generationId);
    },
    {
      connection: redisConnection,
      concurrency: 2
    }
  );

  worker.on("failed", (job, error) => {
    console.error(`Sprite job failed ${job?.id ?? "unknown"}:`, error);
  });

  return worker;
};
