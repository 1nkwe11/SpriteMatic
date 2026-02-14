import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { generateSpriteSchema } from "./generate.schemas.js";
import { enqueueSpriteJob } from "../queue/sprite.queue.js";
import {
  buildRegenerationInput,
  createGenerationRequest,
  deleteGenerationById,
  getGenerationById,
  listGenerationsForUser,
  processGeneration,
  shouldQueueGeneration
} from "../services/sprite.service.js";

export const generateRouter = Router();

generateRouter.use(requireAuth);

generateRouter.post("/sprite", validateBody(generateSpriteSchema), async (req, res) => {
  const role = req.auth?.role ?? UserRole.USER;
  const userId = req.auth!.userId;

  const prepared = await createGenerationRequest({
    userId,
    role,
    input: req.body
  });

  if (prepared.cached) {
    return res.json({
      queued: false,
      cacheHit: true,
      generation: prepared.cached
    });
  }

  if (!prepared.generation) {
    return res.status(500).json({ message: "Failed to initialize generation" });
  }

  if (shouldQueueGeneration(req.body)) {
    const job = await enqueueSpriteJob(prepared.generation.id);
    return res.status(202).json({
      queued: true,
      jobId: job.id,
      generationId: prepared.generation.id
    });
  }

  const generation = await processGeneration(prepared.generation.id);
  return res.status(generation.status === "failed" ? 422 : 201).json({
    queued: false,
    generation
  });
});

generateRouter.get("/jobs/:generationId", async (req, res) => {
  const generation = await getGenerationById(req.params.generationId, req.auth!.userId);
  res.json({
    generation
  });
});

generateRouter.get("/history", async (req, res) => {
  const generations = await listGenerationsForUser(req.auth!.userId);
  res.json({
    generations
  });
});

generateRouter.get("/:id", async (req, res) => {
  const generation = await getGenerationById(req.params.id, req.auth!.userId);
  res.json({
    generation
  });
});

generateRouter.delete("/:id", async (req, res) => {
  await deleteGenerationById(req.params.id, req.auth!.userId);
  res.json({
    success: true
  });
});

generateRouter.post("/:id/regenerate", async (req, res) => {
  const regenerationInput = await buildRegenerationInput(req.params.id, req.auth!.userId);

  const prepared = await createGenerationRequest({
    userId: req.auth!.userId,
    role: req.auth?.role ?? UserRole.USER,
    input: regenerationInput
  });

  if (!prepared.generation) {
    return res.status(500).json({ message: "Failed to initialize regeneration" });
  }

  if (shouldQueueGeneration(regenerationInput)) {
    const job = await enqueueSpriteJob(prepared.generation.id);
    return res.status(202).json({
      queued: true,
      jobId: job.id,
      generationId: prepared.generation.id
    });
  }

  const generation = await processGeneration(prepared.generation.id);
  return res.status(generation.status === "failed" ? 422 : 201).json({
    queued: false,
    generation
  });
});
