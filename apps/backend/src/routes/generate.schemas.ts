import { z } from "zod";

export const generateSpriteSchema = z.object({
  prompt: z.string().min(4).max(500),
  spriteSize: z.number().int().min(32).max(128),
  frameCount: z.number().int().min(1).max(64),
  projection: z.enum(["2D", "isometric"]),
  animationType: z.string().min(2).max(40),
  styleIntensity: z.number().int().min(0).max(100).default(70),
  layout: z.enum(["row", "grid"]).default("row"),
  columns: z.number().int().min(1).max(64).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  model: z
    .enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "gpt-image-1"])
    .optional()
});
