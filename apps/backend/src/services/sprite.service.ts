import crypto from "crypto";
import { GenerationStatus, ProjectionType, UserRole, type SpriteGeneration } from "@prisma/client";
import sharp from "sharp";
import { env } from "../config/env.js";
import { openai } from "../lib/openai.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { getSignedImageUrl, uploadImage } from "../lib/s3.js";
import { buildSpriteSheetJson } from "../utils/sprite-json.js";
import { ApiError } from "../utils/errors.js";
import { logger } from "../observability/logger.js";
import { buildQualityCorrectionPrompt, buildSpritePrompt, type ProjectionInput } from "./prompt-builder.js";
import {
  type QualityDiagnostics,
  stabilizeSpriteSheet,
  validateSpriteQuality,
  verifyImageAgainstRequestedSettings,
  type SettingsVerificationResult
} from "./quality.service.js";

export type GenerateSpriteInput = {
  prompt: string;
  spriteSize: number;
  frameCount: number;
  projection: "2D" | "isometric";
  animationType: string;
  styleIntensity: number;
  layout: "row" | "grid";
  columns?: number;
  seed?: number;
  model?: string;
};

export type GenerationResponse = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  frameCount: number;
  spriteSize: number;
  projection: "2D" | "isometric";
  animationType: string;
  columns: number;
  rows: number;
  createdAt: Date;
  imageUrl?: string;
  jsonConfig?: unknown;
  qualityWarnings: string[];
  errorReason?: string | null;
  seed?: number | null;
  modelVersion: string;
  settingsVerification?: SettingsVerificationResult;
  qualityDiagnostics?: QualityDiagnostics;
  promptTokens: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd: number | null;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type GenerationTokenEstimate = TokenUsage & {
  estimatedOutputTokens: number;
};

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const STALE_GENERATION_MS = 5 * 60 * 1000;

const projectionToDb = (projection: ProjectionInput) =>
  projection === "2D" ? ProjectionType.TWO_D : ProjectionType.ISOMETRIC;

const projectionToApi = (projectionType: ProjectionType): "2D" | "isometric" =>
  projectionType === ProjectionType.TWO_D ? "2D" : "isometric";

const normalizePrompt = (value: string) => value.trim().replace(/\s+/g, " ");

const validatePromptStructure = (value: string) => {
  const prompt = normalizePrompt(value);
  if (prompt.length < 4) {
    throw new ApiError(400, "Prompt is too short");
  }

  if (/[<>]/.test(prompt)) {
    throw new ApiError(400, "Prompt contains disallowed characters");
  }
  return prompt;
};

const resolveLayout = (frameCount: number, layout: "row" | "grid", columns?: number) => {
  if (layout === "row") {
    return { columns: frameCount, rows: 1 };
  }

  const finalColumns = columns ?? Math.max(1, Math.ceil(Math.sqrt(frameCount)));
  const rows = Math.ceil(frameCount / finalColumns);
  return { columns: finalColumns, rows };
};

const fingerprintForGeneration = (args: {
  userId: string;
  prompt: string;
  spriteSize: number;
  frameCount: number;
  projection: string;
  animationType: string;
  styleIntensity: number;
  columns: number;
  rows: number;
  seed: number;
  modelVersion: string;
}) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        ...args
      })
    )
    .digest("hex");

const cacheKey = (fingerprint: string) => `sprite-cache:${fingerprint}`;

type ModelProfile = {
  inputPerMTokens: number;
  outputPerMTokens: number;
  maxAttempts: number;
  compactPrompt: boolean;
  correctionIssueLimit?: number;
};

const modelRates: Record<
  string,
  ModelProfile
> = {
  "gpt-4.1": {
    inputPerMTokens: 2.0,
    outputPerMTokens: 8.0,
    maxAttempts: 4,
    compactPrompt: false,
    correctionIssueLimit: 2
  },
  "gpt-4.1-mini": {
    inputPerMTokens: 0.4,
    outputPerMTokens: 1.6,
    maxAttempts: 3,
    compactPrompt: true,
    correctionIssueLimit: 2
  },
  "gpt-4.1-nano": {
    inputPerMTokens: 0.1,
    outputPerMTokens: 0.4,
    maxAttempts: 4,
    compactPrompt: true,
    correctionIssueLimit: 3
  },
  "gpt-4o": {
    inputPerMTokens: 2.5,
    outputPerMTokens: 10.0,
    maxAttempts: 3,
    compactPrompt: false,
    correctionIssueLimit: 2
  },
  "gpt-4o-mini": {
    inputPerMTokens: 0.15,
    outputPerMTokens: 0.6,
    maxAttempts: 2,
    compactPrompt: true,
    correctionIssueLimit: 2
  },
  "gpt-image-1": {
    inputPerMTokens: 0.4,
    outputPerMTokens: 0,
    maxAttempts: 4,
    compactPrompt: false,
    correctionIssueLimit: 4
  }
};

const getModelProfile = (model: string) => {
  return (
    modelRates[model] ?? {
      inputPerMTokens: 0.4,
      outputPerMTokens: 0,
      maxAttempts: 3,
      compactPrompt: false,
      correctionIssueLimit: 2
    }
  );
};

const estimateCostUsd = ({
  model,
  inputTokens,
  outputTokens = 0
}: {
  model: string;
  inputTokens: number;
  outputTokens?: number;
}) => {
  const rates = getModelProfile(model);
  if (!rates) return null;
  const inputCost = (inputTokens / 1_000_000) * rates.inputPerMTokens;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPerMTokens;
  return inputCost + outputCost;
};

const estimateTotalCostUsd = ({
  model,
  tokenUsage,
  estimatedOutputTokens
}: {
  model: string;
  tokenUsage: Pick<GenerationTokenEstimate, "inputTokens" | "outputTokens">;
  estimatedOutputTokens: number;
}) => {
  const outputForCost = tokenUsage.outputTokens > 0 ? tokenUsage.outputTokens : estimatedOutputTokens;
  return (
    estimateCostUsd({
      model,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: outputForCost
    }) ?? null
  );
};

const estimateTokens = (text: string) => {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
};

const estimateOutputTokens = (args: { spriteSize: number; columns: number; rows: number }) => {
  const sheetPixels = args.spriteSize * args.spriteSize * args.columns * args.rows;
  return Math.min(Math.max(Math.round(sheetPixels / 20), 512), 12000);
};

const buildWarningSignature = (warnings: string[]) =>
  Array.from(
    new Set(
      warnings
        .map((warning) => warning.toLowerCase().trim())
        .filter((warning) => warning.length > 0)
    )
  )
    .sort()
    .join("|");

const buildAttemptCostEstimate = ({
  model,
  prompt,
  outputTokensEstimate
}: {
  model: string;
  prompt: string;
  outputTokensEstimate: number;
}) => {
  const promptTokensEstimate = estimateTokens(prompt);
  return estimateCostUsd({
    model,
    inputTokens: promptTokensEstimate,
    outputTokens: outputTokensEstimate
  }) ?? 0;
};

const buildTokenUsage = (inputTokens: number, outputTokens: number, estimatedOutputTokens: number): GenerationTokenEstimate => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  estimatedOutputTokens
});

const chooseOutputSize = (columns: number, rows: number): "1024x1024" | "1536x1024" | "1024x1536" => {
  if (columns > rows) return "1536x1024";
  if (rows > columns) return "1024x1536";
  return "1024x1024";
};

const replaceSeedLine = (prompt: string, seed: number) => {
  const lines = prompt.split(/\r?\n/);
  const nextSeed = Number.isFinite(seed) ? Math.abs(seed >>> 0) : 0;
  const seedLine = `seed=${nextSeed}`;

  const nextLines = lines.map((line) => {
    if (/^\s*seed=/i.test(line.trim())) {
      return seedLine;
    }

    return line;
  });

  if (nextLines.every((line) => !/^\s*seed=/i.test(line.trim()))) {
    nextLines.push(seedLine);
  }

  return nextLines.join("\n");
};

const attemptSeedForAttempt = (seed: number | null, generationId: string, attempt: number) => {
  const normalizedSeed = typeof seed === "number" ? seed : 0;
  const hashed = `${generationId}:${normalizedSeed}:${attempt}`;
  const digest = crypto.createHash("sha256").update(hashed).digest();
  const candidate = digest.readUInt32LE(0);
  return candidate;
};

const MODEL_ACCESS_FALLBACK = "gpt-image-1";

const extractOpenAiError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "OpenAI request failed";
  const normalized = message.toLowerCase();
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  return { message, normalized, status };
};

const isVerificationPropagationMessage = (normalizedMessage: string) =>
  normalizedMessage.includes("organization must be verified to use the model") ||
  (normalizedMessage.includes("just verified") && normalizedMessage.includes("15 minutes"));

const mapOpenAiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }

  const { message, normalized, status } = extractOpenAiError(error);

  if (normalized.includes("billing hard limit") || normalized.includes("insufficient_quota")) {
    return new ApiError(402, "OpenAI billing limit reached. Add credits and retry.");
  }

  if (status === 403 && isVerificationPropagationMessage(normalized)) {
    return new ApiError(
      403,
      `Model access is pending organization verification propagation. Wait up to 15 minutes or choose ${MODEL_ACCESS_FALLBACK}.`
    );
  }

  if (status === 401) {
    return new ApiError(502, "OpenAI authentication failed. Check OPENAI_API_KEY.");
  }

  if (status === 429) {
    return new ApiError(429, "OpenAI rate limit reached. Please retry shortly.");
  }

  return new ApiError(502, `OpenAI image generation failed: ${message}`);
};

const generateRawImage = async ({
  prompt,
  userId,
  columns,
  rows,
  model
}: {
  prompt: string;
  userId: string;
  columns: number;
  rows: number;
  model: string;
}) => {
  const fallbackPromptTokens = estimateTokens(prompt);
  const requestImage = async (imageModel: string) =>
    openai.images.generate({
      model: imageModel,
      prompt,
      background: "transparent",
      output_format: "png",
      quality: "high",
      size: chooseOutputSize(columns, rows),
      user: userId
    });

  let imageResponse;
  let modelUsed = model;
  try {
    imageResponse = await requestImage(modelUsed);
  } catch (error) {
    const { normalized, status } = extractOpenAiError(error);
    const verificationPropagationPending = status === 403 && isVerificationPropagationMessage(normalized);
    const transientOrUnsupportedServerError = status >= 500 && status < 600;
    const shouldFallback =
      modelUsed !== MODEL_ACCESS_FALLBACK &&
      (verificationPropagationPending || transientOrUnsupportedServerError);

    if (!shouldFallback) {
      throw mapOpenAiError(error);
    }

    modelUsed = MODEL_ACCESS_FALLBACK;
    logger.warn("generation_model_access_fallback", {
      requestedModel: model,
      fallbackModel: modelUsed,
      reason: verificationPropagationPending ? "organization_verification_pending" : "openai_server_error"
    });

    try {
      imageResponse = await requestImage(modelUsed);
    } catch (fallbackError) {
      throw mapOpenAiError(fallbackError);
    }
  }

  const usage = imageResponse.usage as
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      }
    | undefined;
  const inputTokens =
    typeof usage?.prompt_tokens === "number" && usage.prompt_tokens > 0
      ? usage.prompt_tokens
      : fallbackPromptTokens;
  const outputTokens = typeof usage?.completion_tokens === "number" && usage.completion_tokens > 0 ? usage.completion_tokens : 0;
  const totalFromUsage = typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined;
  const finalOutputTokens =
    outputTokens > 0
      ? outputTokens
      : Math.max(0, typeof totalFromUsage === "number" && totalFromUsage >= inputTokens ? totalFromUsage - inputTokens : 0);
  const totalTokens =
    typeof totalFromUsage === "number" ? totalFromUsage : inputTokens + finalOutputTokens;

  const b64 = imageResponse.data?.[0]?.b64_json;
  if (b64) {
    return {
      buffer: Buffer.from(b64, "base64"),
      modelUsed,
      tokenUsage: {
        inputTokens,
        outputTokens: finalOutputTokens,
        totalTokens
      }
    };
  }

  const url = imageResponse.data?.[0]?.url;
  if (!url) {
    throw new ApiError(502, "Image generation returned no image payload");
  }

  const fetched = await fetch(url);
  if (!fetched.ok) {
    throw new ApiError(502, "Failed to download generated image");
  }

  const arr = await fetched.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    modelUsed,
    tokenUsage: {
      inputTokens,
      outputTokens: finalOutputTokens,
      totalTokens
    }
  };
};

const normalizeToSpriteDimensions = async ({
  buffer,
  spriteSize,
  columns,
  rows
}: {
  buffer: Buffer;
  spriteSize: number;
  columns: number;
  rows: number;
}) =>
  {
    const sourceMetadata = await sharp(buffer).ensureAlpha().metadata();
    const sourceWidth = sourceMetadata.width ?? 0;
    const sourceHeight = sourceMetadata.height ?? 0;
    const targetWidth = spriteSize * columns;
    const targetHeight = spriteSize * rows;

    if (!sourceWidth || !sourceHeight || sourceWidth < columns || sourceHeight < rows) {
      return sharp(buffer)
        .resize(targetWidth, targetHeight, {
          fit: "fill",
          kernel: "nearest"
        })
        .png()
        .toBuffer();
    }

    const sourceFrameWidth = Math.max(1, Math.floor(sourceWidth / columns));
    const sourceFrameHeight = Math.max(1, Math.floor(sourceHeight / rows));
    const frameComposites: Array<{
      input: Buffer;
      left: number;
      top: number;
    }> = [];

    for (let frameIndex = 0; frameIndex < columns * rows; frameIndex += 1) {
      const col = frameIndex % columns;
      const row = Math.floor(frameIndex / columns);
      const sourceLeft = col * sourceFrameWidth;
      const sourceTop = row * sourceFrameHeight;

      if (sourceLeft >= sourceWidth || sourceTop >= sourceHeight) {
        continue;
      }

      const sourceFrameRight = col === columns - 1 ? sourceWidth : sourceLeft + sourceFrameWidth;
      const sourceFrameBottom = row === rows - 1 ? sourceHeight : sourceTop + sourceFrameHeight;
      const extractWidth = Math.max(1, sourceFrameRight - sourceLeft);
      const extractHeight = Math.max(1, sourceFrameBottom - sourceTop);

      const resizedFrame = await sharp(buffer)
        .ensureAlpha()
        .extract({
          left: sourceLeft,
          top: sourceTop,
          width: Math.min(extractWidth, Math.max(1, sourceWidth - sourceLeft)),
          height: Math.min(extractHeight, Math.max(1, sourceHeight - sourceTop))
        })
        .resize(spriteSize, spriteSize, {
          fit: "contain",
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0
          },
          kernel: "nearest"
        })
        .png()
        .toBuffer();

      frameComposites.push({
        input: resizedFrame,
        left: col * spriteSize,
        top: row * spriteSize
      });
    }

    const targetCanvas = sharp({
      create: {
        width: targetWidth,
        height: targetHeight,
        channels: 4,
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0
        }
      }
    });

    if (frameComposites.length === 0) {
      return targetCanvas.png().toBuffer();
    }

    return targetCanvas
      .composite(frameComposites)
      .png()
      .toBuffer();
  };

const enforcePixelArtClarity = async (buffer: Buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= 16) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }

    data[i] = (data[i] >> 4) << 4;
    data[i + 1] = (data[i + 1] >> 4) << 4;
    data[i + 2] = (data[i + 2] >> 4) << 4;
    data[i + 3] = 255;
  }

  return sharp(data, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
};

type FrameOccupancy = {
  frameIndex: number;
  originX: number;
  originY: number;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MIN_FRAME_FILL_RATIO = 0.015;
const OPAQUE_PIXEL_ALPHA_THRESHOLD = 16;

const findFrameOccupancy = ({
  data,
  width,
  spriteSize,
  columns,
  frameCount,
  rows
}: {
  data: Buffer;
  width: number;
  spriteSize: number;
  columns: number;
  frameCount: number;
  rows: number;
}) => {
  const totalSlots = columns * rows;
  const activeFrames = Math.max(1, Math.min(frameCount, totalSlots));
  const summaries: Array<FrameOccupancy> = [];

  for (let frameIndex = 0; frameIndex < activeFrames; frameIndex += 1) {
    const originX = (frameIndex % columns) * spriteSize;
    const originY = Math.floor(frameIndex / columns) * spriteSize;
    let pixelCount = 0;
    let minX = spriteSize;
    let minY = spriteSize;
    let maxX = -1;
    let maxY = -1;

    for (let localY = 0; localY < spriteSize; localY += 1) {
      for (let localX = 0; localX < spriteSize; localX += 1) {
        const x = originX + localX;
        const y = originY + localY;
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha <= OPAQUE_PIXEL_ALPHA_THRESHOLD) {
          continue;
        }

        pixelCount += 1;
        minX = Math.min(minX, localX);
        minY = Math.min(minY, localY);
        maxX = Math.max(maxX, localX);
        maxY = Math.max(maxY, localY);
      }
    }

    summaries.push({
      frameIndex,
      originX,
      originY,
      pixelCount,
      minX: Math.max(0, minX),
      minY: Math.max(0, minY),
      maxX: Math.max(0, maxX),
      maxY: Math.max(0, maxY)
    });
  }

  return summaries;
};

const selectNearestDonorFrame = (targetFrame: number, candidates: FrameOccupancy[]) => {
  return candidates.reduce((best, candidate) => {
    const distance = Math.abs(candidate.frameIndex - targetFrame);
    const currentDistance = Math.abs(best.frameIndex - targetFrame);
    return distance < currentDistance ? candidate : best;
  }, candidates[0]);
};

const toByte = (value: number) => Math.min(255, Math.max(0, value));

const repairNearEmptyFrames = async ({
  buffer,
  spriteSize,
  columns,
  rows,
  frameCount
}: {
  buffer: Buffer;
  spriteSize: number;
  columns: number;
  rows: number;
  frameCount: number;
}) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const targetMinFillPixels = Math.max(1, Math.floor(spriteSize * spriteSize * MIN_FRAME_FILL_RATIO));
  const frameSummaries = findFrameOccupancy({
    data,
    width,
    spriteSize,
    columns,
    frameCount,
    rows
  });

  const nonEmptyFrames = frameSummaries.filter((frame) => frame.pixelCount >= targetMinFillPixels);
  const nearEmptyFrames = frameSummaries.filter((frame) => frame.pixelCount < targetMinFillPixels);

  if (nearEmptyFrames.length === 0 || nonEmptyFrames.length === 0) {
    return {
      buffer,
      repairedSlots: 0,
      repairedFrameIndices: []
    };
  }

  const output = Buffer.from(data);
  const repairedFrameIndices: number[] = [];

  for (const emptyFrame of nearEmptyFrames) {
    const donor = selectNearestDonorFrame(emptyFrame.frameIndex, nonEmptyFrames);
    if (!donor || donor.pixelCount === 0) {
      continue;
    }

    const insetX = Math.min(1, Math.max(0, Math.floor((donor.maxX - donor.minX + 1) * 0.08)));
    const insetY = Math.min(1, Math.max(0, Math.floor((donor.maxY - donor.minY + 1) * 0.08)));
    const donorMinX = donor.minX + insetX;
    const donorMinY = donor.minY + insetY;
    const donorMaxX = Math.max(donor.minX, donor.maxX - insetX);
    const donorMaxY = Math.max(donor.minY, donor.maxY - insetY);
    const donorWidth = donorMaxX - donorMinX + 1;
    const donorHeight = donorMaxY - donorMinY + 1;

    if (donorWidth <= 0 || donorHeight <= 0) {
      continue;
    }

    const jitterX = (emptyFrame.frameIndex % 3) - 1;
    const jitterY = (Math.floor(emptyFrame.frameIndex / 3) % 3) - 1;
    const destCenterX = Math.floor(spriteSize / 2) + jitterX;
    const destCenterY = Math.floor(spriteSize / 2) + jitterY;
    const destStartX = Math.max(
      emptyFrame.originX,
      Math.min(emptyFrame.originX + spriteSize - donorWidth, emptyFrame.originX + destCenterX - Math.floor(donorWidth / 2))
    );
    const destStartY = Math.max(
      emptyFrame.originY,
      Math.min(emptyFrame.originY + spriteSize - donorHeight, emptyFrame.originY + destCenterY - Math.floor(donorHeight / 2))
    );

    let copiedPixels = 0;
    const colorShift = ((emptyFrame.frameIndex + donor.frameIndex) % 3) - 1;

    for (let localY = 0; localY < donorHeight; localY += 1) {
      for (let localX = 0; localX < donorWidth; localX += 1) {
        const sourceX = donor.originX + donorMinX + localX;
        const sourceY = donor.originY + donorMinY + localY;

        if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) continue;
        const sourceOffset = (sourceY * width + sourceX) * 4;
        const sourceAlpha = data[sourceOffset + 3];
        if (sourceAlpha <= OPAQUE_PIXEL_ALPHA_THRESHOLD) {
          continue;
        }

        const destinationX = destStartX + localX;
        const destinationY = destStartY + localY;
        if (destinationX < emptyFrame.originX || destinationY < emptyFrame.originY) continue;
        if (destinationX >= emptyFrame.originX + spriteSize || destinationY >= emptyFrame.originY + spriteSize) continue;

        const destinationOffset = (destinationY * width + destinationX) * 4;
        output[destinationOffset] = toByte(data[sourceOffset] + colorShift);
        output[destinationOffset + 1] = toByte(data[sourceOffset + 1] + colorShift);
        output[destinationOffset + 2] = toByte(data[sourceOffset + 2] + colorShift);
        output[destinationOffset + 3] = sourceAlpha;
        copiedPixels += 1;
      }
    }

    if (copiedPixels > 0) {
      repairedFrameIndices.push(emptyFrame.frameIndex);
    }
  }

  if (repairedFrameIndices.length === 0) {
    return {
      buffer,
      repairedSlots: 0,
      repairedFrameIndices: []
    };
  }

  return {
    buffer: await sharp(output, {
      raw: {
        width,
        height,
        channels: 4
      }
    })
      .png()
      .toBuffer(),
    repairedSlots: repairedFrameIndices.length,
    repairedFrameIndices
  };
};

const assertDailyLimit = async (userId: string, role: UserRole) => {
  if (role === UserRole.ADMIN) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyGenerationLimit: true }
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todaysCount = await prisma.spriteGeneration.count({
    where: {
      userId,
      createdAt: {
        gte: startOfDay
      }
    }
  });

  if (todaysCount >= user.dailyGenerationLimit) {
    throw new ApiError(429, "Daily generation limit reached");
  }
};

const toResponseStatus = (status: GenerationStatus): GenerationResponse["status"] => {
  switch (status) {
    case GenerationStatus.PENDING:
      return "pending";
    case GenerationStatus.PROCESSING:
      return "processing";
    case GenerationStatus.COMPLETED:
      return "completed";
    case GenerationStatus.FAILED:
      return "failed";
    default:
      return "failed";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseTokenUsage = (jsonConfig: unknown): GenerationTokenEstimate | null => {
  if (!isRecord(jsonConfig)) return null;
  const candidate = jsonConfig.tokenUsage;
  if (!isRecord(candidate)) return null;
  if (typeof candidate.inputTokens !== "number" || typeof candidate.outputTokens !== "number") return null;
  if (typeof candidate.totalTokens !== "number") return null;
  const estimatedOutputTokens =
    typeof candidate.estimatedOutputTokens === "number" ? candidate.estimatedOutputTokens : 0;
  return {
    inputTokens: Math.max(0, Math.round(candidate.inputTokens)),
    outputTokens: Math.max(0, Math.round(candidate.outputTokens)),
    totalTokens: Math.max(0, Math.round(candidate.totalTokens)),
    estimatedOutputTokens
  };
};

const parseSettingsVerification = (jsonConfig: unknown): SettingsVerificationResult | undefined => {
  if (!isRecord(jsonConfig)) return undefined;
  const candidate = jsonConfig.verification;
  if (!isRecord(candidate)) return undefined;
  if (typeof candidate.passed !== "boolean") return undefined;
  if (typeof candidate.summary !== "string") return undefined;
  if (!Array.isArray(candidate.failures)) return undefined;
  return candidate as SettingsVerificationResult;
};

const parseQualityDiagnostics = (jsonConfig: unknown): QualityDiagnostics | undefined => {
  if (!isRecord(jsonConfig)) return undefined;
  const candidate = jsonConfig.quality;
  if (!isRecord(candidate)) return undefined;
  if (typeof candidate.score !== "number") return undefined;
  if (!isRecord(candidate.thresholds)) return undefined;
  if (!isRecord(candidate.metrics)) return undefined;
  if (!Array.isArray(candidate.frameSummaries)) return undefined;
  return candidate as QualityDiagnostics;
};

const hydrateGenerationResponse = async (generation: SpriteGeneration): Promise<GenerationResponse> => {
  const imageUrl = generation.imageKey ? await getSignedImageUrl(generation.imageKey) : undefined;
  const settingsVerification = parseSettingsVerification(generation.jsonConfig);
  const qualityDiagnostics = parseQualityDiagnostics(generation.jsonConfig);
  const observedUsage = parseTokenUsage(generation.jsonConfig);
  const estimatedOutputTokens = estimateOutputTokens({
    spriteSize: generation.spriteSize,
    columns: generation.columns,
    rows: generation.rows
  });
  const promptTokens = generation.promptTokens;
  const outputTokens = observedUsage?.outputTokens;
  const totalTokens = observedUsage?.totalTokens;
  const estimatedCostUsd = estimateTotalCostUsd({
    model: generation.modelVersion,
    tokenUsage: {
      inputTokens: promptTokens,
      outputTokens: outputTokens ?? 0
    },
    estimatedOutputTokens: observedUsage?.estimatedOutputTokens
      ? observedUsage.estimatedOutputTokens
      : estimatedOutputTokens
  });

  return {
    id: generation.id,
    status: toResponseStatus(generation.status),
    frameCount: generation.frameCount,
    spriteSize: generation.spriteSize,
    projection: projectionToApi(generation.projectionType),
    animationType: generation.animationType,
    columns: generation.columns,
    rows: generation.rows,
    createdAt: generation.createdAt,
    imageUrl,
    jsonConfig: generation.jsonConfig ?? undefined,
    qualityWarnings: generation.qualityWarnings,
    errorReason: generation.errorReason,
    seed: generation.seed,
    modelVersion: generation.modelVersion,
    settingsVerification,
    qualityDiagnostics,
    promptTokens,
    outputTokens,
    totalTokens,
    estimatedOutputTokens: observedUsage?.estimatedOutputTokens
      ? observedUsage.estimatedOutputTokens
      : estimatedOutputTokens,
    estimatedCostUsd
  };
};

const markStaleGenerationFailed = async (generation: SpriteGeneration) => {
  const isInProgress =
    generation.status === GenerationStatus.PENDING || generation.status === GenerationStatus.PROCESSING;
  const stale = Date.now() - generation.updatedAt.getTime() > STALE_GENERATION_MS;

  if (!isInProgress || !stale) {
    return generation;
  }

  return prisma.spriteGeneration.update({
    where: { id: generation.id },
    data: {
      status: GenerationStatus.FAILED,
      errorReason: "Generation did not complete and timed out. Please regenerate."
    }
  });
};

export const shouldQueueGeneration = (input: GenerateSpriteInput) =>
  input.frameCount * input.spriteSize > 768 || input.frameCount > 10 || input.spriteSize > 96;

export const createGenerationRequest = async ({
  userId,
  role,
  input
}: {
  userId: string;
  role: UserRole;
  input: GenerateSpriteInput;
}) => {
  await assertDailyLimit(userId, role);

  const themePrompt = validatePromptStructure(input.prompt);
  const { columns, rows } = resolveLayout(input.frameCount, input.layout, input.columns);
  const seed = input.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const selectedModel = input.model ?? env.OPENAI_IMAGE_MODEL;
  const modelProfile = getModelProfile(selectedModel);
  const configuredMaxAttempts = Math.max(1, env.QUALITY_MAX_ATTEMPTS);
  const maxAttempts = Math.min(modelProfile.maxAttempts, configuredMaxAttempts);
  const fullPrompt = buildSpritePrompt({
    themePrompt,
    spriteSize: input.spriteSize,
    frameCount: input.frameCount,
    projection: input.projection,
    animationType: input.animationType,
    styleIntensity: input.styleIntensity,
    columns,
    rows,
    seed,
    compact: modelProfile.compactPrompt
  });
  const estimatedPromptTokens = estimateTokens(fullPrompt);
  const estimatedOutputTokensPerAttempt = estimateOutputTokens({
    spriteSize: input.spriteSize,
    columns,
    rows
  });
  const estimatedCostUsd = estimateCostUsd({
    model: selectedModel,
    inputTokens: estimatedPromptTokens * maxAttempts,
    outputTokens: estimatedOutputTokensPerAttempt * maxAttempts
  });

  if (estimatedCostUsd !== null && estimatedCostUsd > env.MAX_ESTIMATED_GENERATION_COST_USD) {
    logger.warn("generation_token_budget_exceeded_precheck", {
      userId,
      model: selectedModel,
      estimatedCostUsd,
      estimatedPromptTokens,
      estimatedOutputTokensPerAttempt,
      estimatedAttempts: maxAttempts,
      budgetUsd: env.MAX_ESTIMATED_GENERATION_COST_USD
    });
    throw new ApiError(402, "Estimated token spend exceeds configured budget. Reduce frame size or choose a cheaper model.");
  }

  const fingerprint = fingerprintForGeneration({
    userId,
    prompt: themePrompt,
    spriteSize: input.spriteSize,
    frameCount: input.frameCount,
    projection: input.projection,
    animationType: input.animationType,
    styleIntensity: input.styleIntensity,
    columns,
    rows,
    seed,
    modelVersion: selectedModel
  });

  const cachedGenerationId = await redis.get(cacheKey(fingerprint));
  if (cachedGenerationId) {
    const cached = await prisma.spriteGeneration.findFirst({
      where: {
        id: cachedGenerationId,
        userId
      }
    });

    if (cached && cached.status !== GenerationStatus.FAILED) {
      return {
        cached: await hydrateGenerationResponse(cached),
        generation: null as null
      };
    }
  }

  const generation = await prisma.spriteGeneration.create({
    data: {
      userId,
      prompt: fullPrompt,
      themePrompt,
      styleIntensity: input.styleIntensity,
      frameCount: input.frameCount,
      spriteSize: input.spriteSize,
      projectionType: projectionToDb(input.projection),
      animationType: input.animationType,
      columns,
      rows,
      modelVersion: selectedModel,
      seed,
      promptTokens: 0,
      qualityWarnings: [],
      status: GenerationStatus.PENDING
    }
  });

  await redis.set(cacheKey(fingerprint), generation.id, "EX", CACHE_TTL_SECONDS);

  return {
    generation,
    cached: null as null
  };
};

type AttemptCandidate = {
  attempt: number;
  buffer: Buffer;
  qualityWarnings: string[];
  qualityDiagnostics: QualityDiagnostics;
  settingsVerification: SettingsVerificationResult;
  tokenUsage: TokenUsage;
  score: number;
  warningSignature: string;
  qualityScore: number;
};

const dedupeWarnings = (warnings: string[]) =>
  Array.from(
    new Set(
      warnings
        .map((warning) => warning.trim())
        .filter((warning) => warning.length > 0)
    )
  );

const candidateRank = (candidate: AttemptCandidate) => {
  const settingsBonus = candidate.settingsVerification.passed ? 1000 : 0;
  const warningPenalty = candidate.qualityWarnings.length * 0.5;
  return settingsBonus + candidate.score - warningPenalty;
};

export const processGeneration = async (generationId: string): Promise<GenerationResponse> => {
  const generation = await prisma.spriteGeneration.findUnique({
    where: { id: generationId }
  });

  if (!generation) {
    throw new ApiError(404, "Generation record not found");
  }

  await prisma.spriteGeneration.update({
    where: { id: generation.id },
    data: {
      status: GenerationStatus.PROCESSING,
      errorReason: null
    }
  });

  let activeModel = generation.modelVersion;
  let modelProfile = getModelProfile(activeModel);
  const configuredMaxAttempts = Math.max(1, env.QUALITY_MAX_ATTEMPTS);
  let maxAttempts = Math.min(modelProfile.maxAttempts, configuredMaxAttempts);
  let correctionIssueLimit = modelProfile.correctionIssueLimit ?? 2;
  let isCorrectionCompact = modelProfile.compactPrompt;
  const estimatedOutputTokensPerAttempt = estimateOutputTokens({
    spriteSize: generation.spriteSize,
    columns: generation.columns,
    rows: generation.rows
  });
  let promptForAttempt = generation.prompt;
  let remainingBudgetUsd = env.MAX_ESTIMATED_GENERATION_COST_USD;
  let stopReason: "token_budget" | "quality_stagnation" | null = null;
  let lastFailureSignature: string | null = null;
  let lastFailureScore = Number.NEGATIVE_INFINITY;
  let failureStallCount = 0;
  let finalBuffer: Buffer | null = null;
  let qualityWarnings: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let settingsVerification: SettingsVerificationResult | null = null;
  let qualityDiagnostics: QualityDiagnostics | null = null;
  let bestCandidate: AttemptCandidate | null = null;
  let successfulAttempt: number | null = null;
  let attemptsExecuted = 0;
  const generationStartedAt = Date.now();
  const requestPayloadFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        userId: generation.userId,
        prompt: generation.themePrompt,
        spriteSize: generation.spriteSize,
        frameCount: generation.frameCount,
        animationType: generation.animationType,
        styleIntensity: generation.styleIntensity,
        columns: generation.columns,
        rows: generation.rows,
        seed: generation.seed ?? 0,
        modelVersion: activeModel
      })
    )
    .digest("hex");

  logger.info("generation_processing_started", {
    generationId: generation.id,
    userId: generation.userId,
    frameCount: generation.frameCount,
    spriteSize: generation.spriteSize,
    columns: generation.columns,
    rows: generation.rows,
    animationType: generation.animationType,
    projection: projectionToApi(generation.projectionType),
    estimatedPromptTokens: estimateTokens(generation.prompt),
    estimatedCostUsd: estimateTotalCostUsd({
      model: activeModel,
      tokenUsage: {
        inputTokens: estimateTokens(generation.prompt),
        outputTokens: 0
      },
      estimatedOutputTokens: estimatedOutputTokensPerAttempt * maxAttempts
    }),
    qualityMinScore: env.QUALITY_MIN_SCORE,
    qualityMaxAttempts: maxAttempts,
    strictQualityGate: env.STRICT_QUALITY_GATE
  });
  logger.info("generation_audit_started", {
    generationId: generation.id,
    requestPayloadFingerprint,
    seed: generation.seed ?? null,
    modelRequested: generation.modelVersion,
    userId: generation.userId,
    frameCount: generation.frameCount,
    spriteSize: generation.spriteSize,
    columns: generation.columns,
    rows: generation.rows,
    animationType: generation.animationType,
    projection: projectionToApi(generation.projectionType),
    qualityMinScore: env.QUALITY_MIN_SCORE,
    maxAttempts,
    strictQualityGate: env.STRICT_QUALITY_GATE
  });

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsExecuted = attempt;
      const seedForAttempt = attemptSeedForAttempt(generation.seed, generation.id, attempt);
      promptForAttempt = replaceSeedLine(promptForAttempt, seedForAttempt);
      if (remainingBudgetUsd <= 0) {
        stopReason = "token_budget";
        logger.warn("generation_budget_exhausted", {
          generationId: generation.id,
          attemptsExecuted,
          remainingBudgetUsd
        });
        break;
      }

      const attemptCost = buildAttemptCostEstimate({
        model: activeModel,
        prompt: promptForAttempt,
        outputTokensEstimate: estimatedOutputTokensPerAttempt
      });

      const attemptPromptFingerprint = crypto
        .createHash("sha256")
        .update(promptForAttempt)
        .digest("hex");

      logger.info("generation_audit_attempt_started", {
        generationId: generation.id,
        attempt,
        maxAttempts,
        model: activeModel,
        attemptCost,
        remainingBudgetUsd,
        promptLength: promptForAttempt.length,
        promptFingerprint: attemptPromptFingerprint
      });

      if (attemptCost > remainingBudgetUsd) {
        stopReason = "token_budget";
        logger.warn("generation_budget_blocked", {
          generationId: generation.id,
          attempt,
          estimatedAttemptCost: attemptCost,
          remainingBudgetUsd
        });
        break;
      }

      const raw = await generateRawImage({
        prompt: promptForAttempt,
        userId: generation.userId,
        columns: generation.columns,
        rows: generation.rows,
        model: activeModel
      });

      logger.info("generation_audit_model_output", {
        generationId: generation.id,
        attempt,
        requestedModel: activeModel,
        modelUsed: raw.modelUsed,
        modelAccessFallbackUsed: raw.modelUsed !== activeModel,
        inputTokens: raw.tokenUsage.inputTokens,
        outputTokens: raw.tokenUsage.outputTokens,
        totalTokens: raw.tokenUsage.totalTokens
      });

      if (raw.modelUsed !== activeModel) {
        const requestedModel = activeModel;
        activeModel = raw.modelUsed;
        modelProfile = getModelProfile(activeModel);
        const adjustedMaxAttempts = Math.min(modelProfile.maxAttempts, configuredMaxAttempts);
        if (adjustedMaxAttempts !== maxAttempts) {
          logger.info("generation_model_profile_adjusted", {
            generationId: generation.id,
            fromModel: requestedModel,
            toModel: activeModel,
            previousMaxAttempts: maxAttempts,
            adjustedMaxAttempts,
            compactPrompt: modelProfile.compactPrompt,
            correctionIssueLimit: modelProfile.correctionIssueLimit ?? 2
          });
          maxAttempts = adjustedMaxAttempts;
        }
        correctionIssueLimit = modelProfile.correctionIssueLimit ?? 2;
        isCorrectionCompact = modelProfile.compactPrompt;
        logger.warn("generation_model_switched", {
          generationId: generation.id,
          requestedModel,
          actualModel: activeModel,
          reason: "model_access_fallback"
        });
        await prisma.spriteGeneration.update({
          where: { id: generation.id },
          data: { modelVersion: activeModel }
        });
      }
      inputTokens += raw.tokenUsage.inputTokens;
      outputTokens += raw.tokenUsage.outputTokens;
      totalTokens += raw.tokenUsage.totalTokens;
      remainingBudgetUsd = Math.max(
        0,
        remainingBudgetUsd -
          (estimateCostUsd({
            model: raw.modelUsed,
            inputTokens: raw.tokenUsage.inputTokens,
            outputTokens: raw.tokenUsage.outputTokens
          }) ?? attemptCost)
      );

      const normalized = await normalizeToSpriteDimensions({
        buffer: raw.buffer,
        spriteSize: generation.spriteSize,
        columns: generation.columns,
        rows: generation.rows
      });
      const cleaned = await enforcePixelArtClarity(normalized);

      const stabilized = await stabilizeSpriteSheet({
        buffer: cleaned,
        spriteSize: generation.spriteSize,
        columns: generation.columns,
        rows: generation.rows,
        frameCount: generation.frameCount
      });

      const qualityResult = await validateSpriteQuality({
        buffer: stabilized,
        spriteSize: generation.spriteSize,
        columns: generation.columns,
        rows: generation.rows,
        frameCount: generation.frameCount,
        animationType: generation.animationType,
        styleIntensity: generation.styleIntensity,
        minScore: env.QUALITY_MIN_SCORE
      });

      let attemptSettingsVerification = await verifyImageAgainstRequestedSettings({
        buffer: stabilized,
        spriteSize: generation.spriteSize,
        frameCount: generation.frameCount,
        columns: generation.columns,
        rows: generation.rows
      });

      let attemptAttemptBuffer = stabilized;
      let attemptQualityResult = qualityResult;
      let frameRepairSlots = 0;
      const missingFrameWarning =
        qualityResult.diagnostics.metrics.emptyFrameCount > 0 ||
        attemptSettingsVerification.failures.some((reason) => reason.includes("non-empty frames"));
      const originalAttemptScore = qualityResult.diagnostics.score + (attemptSettingsVerification.passed ? 0 : -18);
      const originalSettingsPassed = attemptSettingsVerification.passed;
      const originalEmptyFrameCount = qualityResult.diagnostics.metrics.emptyFrameCount;

      if (missingFrameWarning) {
        const repaired = await repairNearEmptyFrames({
          buffer: stabilized,
          spriteSize: generation.spriteSize,
          columns: generation.columns,
          rows: generation.rows,
          frameCount: generation.frameCount
        });

        if (repaired.repairedSlots > 0) {
          const repairedStabilized = await stabilizeSpriteSheet({
            buffer: repaired.buffer,
            spriteSize: generation.spriteSize,
            columns: generation.columns,
            rows: generation.rows,
            frameCount: generation.frameCount
          });
          const repairedQualityResult = await validateSpriteQuality({
            buffer: repairedStabilized,
            spriteSize: generation.spriteSize,
            columns: generation.columns,
            rows: generation.rows,
            frameCount: generation.frameCount,
            animationType: generation.animationType,
            styleIntensity: generation.styleIntensity,
            minScore: env.QUALITY_MIN_SCORE
          });
          const repairedSettings = await verifyImageAgainstRequestedSettings({
            buffer: repairedStabilized,
            spriteSize: generation.spriteSize,
            frameCount: generation.frameCount,
            columns: generation.columns,
            rows: generation.rows
          });
          const repairedAttemptScore = repairedQualityResult.diagnostics.score + (repairedSettings.passed ? 0 : -18);
          const repairedImprovedEmptyFrames = repairedQualityResult.diagnostics.metrics.emptyFrameCount < originalEmptyFrameCount;
          const shouldUseRepairedAttempt =
            repairedAttemptScore > originalAttemptScore ||
            (repairedSettings.passed && !originalSettingsPassed) ||
            repairedImprovedEmptyFrames;
          if (shouldUseRepairedAttempt) {
            attemptAttemptBuffer = repairedStabilized;
            attemptQualityResult = repairedQualityResult;
            attemptSettingsVerification = repairedSettings;
            frameRepairSlots = repaired.repairedSlots;
            logger.info("generation_frame_repair_attempt", {
              generationId: generation.id,
              attempt,
              repairedSlots: repaired.repairedSlots,
              repairedFrameIndices: repaired.repairedFrameIndices,
              originalQualityScore: qualityResult.diagnostics.score,
              repairedQualityScore: repairedQualityResult.diagnostics.score,
              originalEmptyFrameCount,
              repairedEmptyFrameCount: repairedQualityResult.diagnostics.metrics.emptyFrameCount,
              originalSettingsPassed,
              repairedSettingsPassed: repairedSettings.passed
            });
          } else {
            logger.info("generation_frame_repair_skipped", {
              generationId: generation.id,
              attempt,
              repairedSlots: repaired.repairedSlots,
              repairedEmptyFrameCount: repairedQualityResult.diagnostics.metrics.emptyFrameCount,
              originalEmptyFrameCount,
              originalAttemptScore,
              repairedAttemptScore
            });
          }
        }
      }

      const attemptWarnings = dedupeWarnings([
        ...attemptQualityResult.reasons,
        ...attemptSettingsVerification.failures
      ]);
      const processingDurationMs = Date.now() - generationStartedAt;
      logger.info("generation_audit_attempt_ready", {
        generationId: generation.id,
        attempt,
        qualityScore: attemptQualityResult.diagnostics.score,
        qualityOk: attemptQualityResult.ok,
        settingsPassed: attemptSettingsVerification.passed,
        frameRepair: attemptAttemptBuffer !== stabilized,
        frameRepairSlots,
        attemptsExecuted,
        durationMsFromStart: processingDurationMs,
        promptFingerprint: attemptPromptFingerprint,
        maxAnchorDriftPx: attemptQualityResult.diagnostics.metrics.maxAnchorDriftPx,
        maxHorizontalDriftPx: attemptQualityResult.diagnostics.metrics.maxHorizontalDriftPx,
        maxVerticalDriftPx: attemptQualityResult.diagnostics.metrics.maxVerticalDriftPx,
        quantizedColorCount: attemptQualityResult.diagnostics.metrics.quantizedColorCount,
        warningSignature: buildWarningSignature(attemptWarnings),
        warnings: attemptWarnings
      });
      const attemptScore =
        attemptQualityResult.diagnostics.score + (attemptSettingsVerification.passed ? 0 : -18);

      const candidate: AttemptCandidate = {
        attempt,
        buffer: attemptAttemptBuffer,
        qualityWarnings: attemptWarnings,
        qualityDiagnostics: attemptQualityResult.diagnostics,
        settingsVerification: attemptSettingsVerification,
        tokenUsage: raw.tokenUsage,
        score: attemptScore,
        warningSignature: buildWarningSignature(attemptWarnings),
        qualityScore: attemptQualityResult.diagnostics.score
      };

      if (!bestCandidate || candidateRank(candidate) > candidateRank(bestCandidate)) {
        bestCandidate = candidate;
      }

      const isFailure = !attemptQualityResult.ok || !attemptSettingsVerification.passed;
      const isStalled =
        isFailure &&
        attempt > 1 &&
        lastFailureSignature === candidate.warningSignature &&
        candidate.qualityScore <= lastFailureScore + 0.75;
      if (isFailure) {
        failureStallCount = isStalled ? failureStallCount + 1 : 0;
        lastFailureSignature = candidate.warningSignature;
        lastFailureScore = candidate.qualityScore;
      } else {
        failureStallCount = 0;
        lastFailureSignature = null;
        lastFailureScore = Number.NEGATIVE_INFINITY;
      }

      if (stopReason === null && isStalled && failureStallCount >= 2) {
        stopReason = "quality_stagnation";
        logger.info("generation_quality_stagnated", {
          generationId: generation.id,
          attempt,
          warningSignature: candidate.warningSignature,
          failureStallCount,
          qualityScore: candidate.qualityScore
        });
        break;
      }

      logger.info("generation_quality_attempt", {
        generationId: generation.id,
        attempt,
        maxAttempts,
        inputTokens: raw.tokenUsage.inputTokens,
        outputTokens: raw.tokenUsage.outputTokens,
        totalTokens: raw.tokenUsage.totalTokens,
        estimatedOutputTokens: estimatedOutputTokensPerAttempt,
        qualityOk: attemptQualityResult.ok,
        settingsPassed: attemptSettingsVerification.passed,
        qualityScore: attemptQualityResult.diagnostics.score,
        rankedScore: attemptScore,
        warningCount: attemptWarnings.length,
        warnings: attemptWarnings,
        qualityMetrics: attemptQualityResult.diagnostics.metrics,
      });

      if (attemptQualityResult.ok && attemptSettingsVerification.passed) {
        finalBuffer = attemptAttemptBuffer;
        qualityWarnings = attemptWarnings;
        settingsVerification = attemptSettingsVerification;
        qualityDiagnostics = attemptQualityResult.diagnostics;
        successfulAttempt = attempt;
        break;
      }

      if (attempt < maxAttempts) {
        promptForAttempt = buildQualityCorrectionPrompt({
          basePrompt: generation.prompt,
          attempt: attempt + 1,
          maxAttempts,
          issues: attemptWarnings,
          compact: isCorrectionCompact,
          issueLimit: correctionIssueLimit
        });
      }
    }

    if (!finalBuffer) {
      const fallbackScoreFloor = env.QUALITY_MIN_SCORE;
      const canAcceptFallback =
        !env.STRICT_QUALITY_GATE &&
        !!bestCandidate &&
        bestCandidate.settingsVerification.passed &&
        bestCandidate.qualityDiagnostics.score >= fallbackScoreFloor;
      const estimatedOutputTokens = estimatedOutputTokensPerAttempt * attemptsExecuted;
      const tokenUsage = buildTokenUsage(inputTokens, outputTokens, estimatedOutputTokens);

      if (canAcceptFallback && bestCandidate) {
        finalBuffer = bestCandidate.buffer;
        qualityWarnings = dedupeWarnings([
          ...bestCandidate.qualityWarnings,
          `Accepted best attempt ${bestCandidate.attempt} at quality score ${bestCandidate.qualityDiagnostics.score.toFixed(
            1
          )} with strict gate disabled`
        ]);
        settingsVerification = bestCandidate.settingsVerification;
        qualityDiagnostics = bestCandidate.qualityDiagnostics;
        successfulAttempt = bestCandidate.attempt;

        logger.warn("generation_quality_fallback_accepted", {
          generationId: generation.id,
          selectedAttempt: bestCandidate.attempt,
          qualityScore: bestCandidate.qualityDiagnostics.score,
          fallbackScoreFloor,
          warningCount: qualityWarnings.length,
          warnings: qualityWarnings
        });
        logger.warn("generation_audit_fallback_accepted", {
          generationId: generation.id,
          attemptsExecuted,
          selectedAttempt: bestCandidate.attempt,
          qualityScore: bestCandidate.qualityDiagnostics.score,
          stopReason,
          warnings: qualityWarnings
        });
      } else {
        const failureWarnings = dedupeWarnings(bestCandidate?.qualityWarnings ?? [
          `Generation stopped after ${attemptsExecuted}/${maxAttempts} attempts`
        ]);
        if (stopReason === "token_budget") {
          failureWarnings.unshift(
            "Stopped early due to token budget limit. Lowering prompt complexity or choosing a cheaper model may help."
          );
        } else if (stopReason === "quality_stagnation") {
          failureWarnings.unshift(
            "Stopped early due to no quality signal improvement across attempts."
          );
        }
        const failureVerification =
          bestCandidate?.settingsVerification ??
          ({
            passed: false,
            summary: "Image does not meet requested settings.",
            failures: ["No valid candidate produced by quality gate."],
            checks: {
              expected: {
                frameWidth: generation.spriteSize,
                frameHeight: generation.spriteSize,
                frameCount: generation.frameCount,
                columns: generation.columns,
                rows: generation.rows,
                sheetWidth: generation.spriteSize * generation.columns,
                sheetHeight: generation.spriteSize * generation.rows
              },
              actual: {
                frameWidth: 0,
                frameHeight: 0,
                frameSlots: generation.columns * generation.rows,
                sheetWidth: 0,
                sheetHeight: 0,
                hasTransparency: false,
                nonEmptyFrameCount: 0,
                unusedSlotsWithContent: 0
              }
            }
          } satisfies SettingsVerificationResult);
        const failureSummary =
          failureVerification.passed && failureWarnings.length > 0
            ? `Quality gate rejected output after ${attemptsExecuted} attempts`
            : failureVerification.summary;
        const failedJson = buildSpriteSheetJson({
          frameWidth: generation.spriteSize,
          frameHeight: generation.spriteSize,
          columns: generation.columns,
          rows: generation.rows,
          frameCount: generation.frameCount,
          animationType: generation.animationType,
          tokenUsage,
          verification: failureVerification,
          quality: bestCandidate?.qualityDiagnostics
        });

        logger.warn("generation_quality_rejected", {
          generationId: generation.id,
          attempts: maxAttempts,
          strictQualityGate: env.STRICT_QUALITY_GATE,
          warningCount: failureWarnings.length,
          warnings: failureWarnings
        });
        logger.warn("generation_audit_rejected", {
          generationId: generation.id,
          attemptsExecuted,
          stopReason,
          strictQualityGate: env.STRICT_QUALITY_GATE,
          warningCount: failureWarnings.length,
          warnings: failureWarnings,
          bestAttempt: bestCandidate?.attempt ?? null,
          bestQualityScore: bestCandidate?.qualityDiagnostics.score ?? null
        });

        const failed = await prisma.spriteGeneration.update({
          where: { id: generation.id },
          data: {
            status: GenerationStatus.FAILED,
            promptTokens: tokenUsage.inputTokens,
            qualityWarnings: failureWarnings,
            errorReason: failureSummary,
            jsonConfig: failedJson
          }
        });

        return hydrateGenerationResponse(failed);
      }
    }

    settingsVerification =
      settingsVerification ??
      (await verifyImageAgainstRequestedSettings({
        buffer: finalBuffer,
        spriteSize: generation.spriteSize,
        frameCount: generation.frameCount,
        columns: generation.columns,
        rows: generation.rows
      }));

      if (!settingsVerification.passed) {
      const tokenUsage = buildTokenUsage(
        inputTokens,
        outputTokens,
        estimatedOutputTokensPerAttempt * attemptsExecuted
      );
      const failedJson = buildSpriteSheetJson({
        frameWidth: generation.spriteSize,
        frameHeight: generation.spriteSize,
        columns: generation.columns,
        rows: generation.rows,
        frameCount: generation.frameCount,
        animationType: generation.animationType,
        tokenUsage,
        verification: settingsVerification,
        quality: qualityDiagnostics ?? bestCandidate?.qualityDiagnostics
      });

      const failed = await prisma.spriteGeneration.update({
        where: { id: generation.id },
        data: {
          status: GenerationStatus.FAILED,
          promptTokens: tokenUsage.inputTokens,
          qualityWarnings: dedupeWarnings([...qualityWarnings, ...settingsVerification.failures]),
          errorReason: settingsVerification.summary,
          jsonConfig: failedJson
        }
      });

      logger.warn("generation_settings_verification_failed", {
        generationId: generation.id,
        attempt: successfulAttempt,
        summary: settingsVerification.summary,
        failures: settingsVerification.failures
      });
      logger.warn("generation_audit_verification_failed", {
        generationId: generation.id,
        attemptsExecuted,
        attempt: successfulAttempt,
        summary: settingsVerification.summary,
        failures: settingsVerification.failures
      });

      return hydrateGenerationResponse(failed);
    }

    const imageKey = `sprites/${generation.userId}/${generation.id}.png`;
    await uploadImage(imageKey, finalBuffer, "image/png");

    const jsonConfig = buildSpriteSheetJson({
      frameWidth: generation.spriteSize,
      frameHeight: generation.spriteSize,
      columns: generation.columns,
      rows: generation.rows,
      frameCount: generation.frameCount,
      animationType: generation.animationType,
      tokenUsage: buildTokenUsage(inputTokens, outputTokens, estimatedOutputTokensPerAttempt * attemptsExecuted),
      verification: settingsVerification,
      quality: qualityDiagnostics ?? bestCandidate?.qualityDiagnostics
    });

    const completed = await prisma.spriteGeneration.update({
      where: { id: generation.id },
      data: {
        status: GenerationStatus.COMPLETED,
        imageKey,
        jsonConfig,
        qualityWarnings,
        promptTokens: inputTokens,
        errorReason: null
      }
    });

    logger.info("generation_completed", {
      generationId: generation.id,
      attempt: successfulAttempt,
      inputTokens,
      qualityScore: (qualityDiagnostics ?? bestCandidate?.qualityDiagnostics)?.score ?? null,
      warningCount: qualityWarnings.length,
      strictQualityGate: env.STRICT_QUALITY_GATE
    });
    logger.info("generation_audit_completed", {
      generationId: generation.id,
      stopReason,
      attemptsExecuted,
      successfulAttempt,
      totalDurationMs: Date.now() - generationStartedAt,
      finalQualityScore: (qualityDiagnostics ?? bestCandidate?.qualityDiagnostics)?.score ?? null,
      warningCount: qualityWarnings.length,
      strictQualityGate: env.STRICT_QUALITY_GATE,
      warningSignature: buildWarningSignature(qualityWarnings),
      inputTokens,
      outputTokens,
      totalTokens,
      requestPayloadFingerprint
    });

    const projection = projectionToApi(completed.projectionType);
    const fingerprint = fingerprintForGeneration({
      userId: generation.userId,
      prompt: completed.themePrompt,
      spriteSize: completed.spriteSize,
      frameCount: completed.frameCount,
      projection,
      animationType: completed.animationType,
      styleIntensity: completed.styleIntensity,
      columns: completed.columns,
      rows: completed.rows,
      seed: completed.seed ?? 0,
      modelVersion: completed.modelVersion
    });

    await redis.set(cacheKey(fingerprint), completed.id, "EX", CACHE_TTL_SECONDS);
    return hydrateGenerationResponse(completed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Generation failed";
    logger.error("generation_unhandled_error", {
      generationId: generation.id,
      inputTokens,
      outputTokens,
      totalTokens,
      reason
    });
    logger.error("generation_audit_error", {
      generationId: generation.id,
      reason,
      attemptsExecuted,
      totalDurationMs: Date.now() - generationStartedAt,
      inputTokens,
      outputTokens,
      totalTokens,
      requestPayloadFingerprint
    });
    await prisma.spriteGeneration.update({
      where: { id: generation.id },
      data: {
        status: GenerationStatus.FAILED,
        promptTokens: inputTokens,
        qualityWarnings,
        errorReason: reason.slice(0, 500)
      }
    });
    throw error;
  }
};

export const getGenerationById = async (generationId: string, userId: string) => {
  const generationRow = await prisma.spriteGeneration.findFirst({
    where: {
      id: generationId,
      userId
    }
  });

  if (!generationRow) {
    throw new ApiError(404, "Generation not found");
  }

  const generation = await markStaleGenerationFailed(generationRow);
  return hydrateGenerationResponse(generation);
};

export const listGenerationsForUser = async (userId: string) => {
  const rows = await prisma.spriteGeneration.findMany({
    where: { userId },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  const stabilized = await Promise.all(rows.map((item) => markStaleGenerationFailed(item)));
  return Promise.all(stabilized.map((item) => hydrateGenerationResponse(item)));
};

export const deleteGenerationById = async (generationId: string, userId: string) => {
  const generation = await prisma.spriteGeneration.findFirst({
    where: {
      id: generationId,
      userId
    }
  });

  if (!generation) {
    throw new ApiError(404, "Generation not found");
  }

  await prisma.spriteGeneration.delete({
    where: { id: generation.id }
  });
};

export const buildRegenerationInput = async (generationId: string, userId: string): Promise<GenerateSpriteInput> => {
  const generation = await prisma.spriteGeneration.findFirst({
    where: {
      id: generationId,
      userId
    }
  });

  if (!generation) {
    throw new ApiError(404, "Generation not found");
  }

  return {
    prompt: generation.themePrompt,
    spriteSize: generation.spriteSize,
    frameCount: generation.frameCount,
    projection: projectionToApi(generation.projectionType),
    animationType: generation.animationType,
    styleIntensity: generation.styleIntensity,
    layout: generation.rows === 1 ? "row" : "grid",
    columns: generation.columns,
    seed: generation.seed ?? undefined,
    model: generation.modelVersion
  };
};
