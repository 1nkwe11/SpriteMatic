import sharp from "sharp";

export type QualityInput = {
  buffer: Buffer;
  spriteSize: number;
  columns: number;
  rows: number;
  frameCount: number;
  animationType?: string;
  styleIntensity?: number;
  minScore?: number;
};

export type FrameQualitySummary = {
  frameIndex: number;
  fillRatio: number;
  translucentRatio: number;
  centroidX: number | null;
  centroidY: number | null;
  clippedEdges: string[];
  bounds:
    | {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
        area: number;
      }
    | null;
};

export type QualityThresholds = {
  minScore: number;
  minTransparentRatio: number;
  maxTranslucentRatio: number;
  maxOuterEdgeOpaqueRatio: number;
  maxBoundaryBleedRatio: number;
  minFrameFillRatio: number;
  maxFrameFillRatio: number;
  maxAnchorDriftPx: number;
  maxHorizontalDriftPx: number;
  maxScaleVarianceRatio: number;
  minMeanConsecutiveDelta: number;
  minDistinctPairRatio: number;
  minQuantizedColorCount: number;
  maxQuantizedColorCount: number;
};

export type QualityMetrics = {
  analyzedFrameCount: number;
  expectedFrameCount: number;
  transparentPixelRatio: number;
  translucentPixelRatio: number;
  quantizedColorCount: number;
  outerEdgeOpaqueRatio: number;
  maxBoundaryBleedRatio: number;
  emptyFrameCount: number;
  overcrowdedFrameCount: number;
  clippedFrameCount: number;
  maxAnchorDriftPx: number;
  maxHorizontalDriftPx: number;
  maxVerticalDriftPx: number;
  scaleVarianceRatio: number;
  meanConsecutiveFrameDelta: number;
  minConsecutiveFrameDelta: number;
  maxConsecutiveFrameDelta: number;
  distinctPairRatio: number;
};

export type QualityDiagnostics = {
  score: number;
  thresholds: QualityThresholds;
  metrics: QualityMetrics;
  frameSummaries: FrameQualitySummary[];
};

export type QualityResult = {
  ok: boolean;
  reasons: string[];
  width: number;
  height: number;
  diagnostics: QualityDiagnostics;
};

export type SettingsVerificationResult = {
  passed: boolean;
  summary: string;
  failures: string[];
  checks: {
    expected: {
      frameWidth: number;
      frameHeight: number;
      frameCount: number;
      columns: number;
      rows: number;
      sheetWidth: number;
      sheetHeight: number;
    };
    actual: {
      frameWidth: number;
      frameHeight: number;
      frameSlots: number;
      sheetWidth: number;
      sheetHeight: number;
      hasTransparency: boolean;
      nonEmptyFrameCount: number;
      unusedSlotsWithContent: number;
    };
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, decimals = 4) => Number(value.toFixed(decimals));

const alphaAt = (pixels: Buffer, index: number) => pixels[index + 3];
const pixelOffset = (x: number, y: number, width: number) => (y * width + x) * 4;

const opaqueRatioForColumn = (pixels: Buffer, width: number, height: number, column: number) => {
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    const offset = pixelOffset(column, y, width);
    if (alphaAt(pixels, offset) > 32) opaque += 1;
  }
  return opaque / Math.max(1, height);
};

const opaqueRatioForRow = (pixels: Buffer, width: number, row: number) => {
  let opaque = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = pixelOffset(x, row, width);
    if (alphaAt(pixels, offset) > 32) opaque += 1;
  }
  return opaque / Math.max(1, width);
};

const frameOrigin = (frameIndex: number, columns: number, spriteSize: number) => ({
  x: (frameIndex % columns) * spriteSize,
  y: Math.floor(frameIndex / columns) * spriteSize
});

const motionThresholdForAnimation = (animationType?: string) => {
  const normalized = (animationType ?? "").trim().toLowerCase();
  if (normalized.includes("idle")) {
    return {
      minMeanConsecutiveDelta: 0.003,
      minDistinctPairRatio: 0.2,
      driftToleranceMultiplier: 1
    };
  }

  if (normalized.includes("walk")) {
    return {
      minMeanConsecutiveDelta: 0.01,
      minDistinctPairRatio: 0.4,
      driftToleranceMultiplier: 1.4
    };
  }

  if (
    normalized.includes("run") ||
    normalized.includes("attack") ||
    normalized.includes("jump") ||
    normalized.includes("dash") ||
    normalized.includes("sprint")
  ) {
    return {
      minMeanConsecutiveDelta: 0.012,
      minDistinctPairRatio: 0.45,
      driftToleranceMultiplier: 1.5
    };
  }

  return {
    minMeanConsecutiveDelta: 0.008,
    minDistinctPairRatio: 0.35,
    driftToleranceMultiplier: 1
  };
};

const computeConsecutiveFrameDelta = ({
  data,
  width,
  columns,
  spriteSize,
  firstFrame,
  secondFrame
}: {
  data: Buffer;
  width: number;
  columns: number;
  spriteSize: number;
  firstFrame: number;
  secondFrame: number;
}) => {
  const first = frameOrigin(firstFrame, columns, spriteSize);
  const second = frameOrigin(secondFrame, columns, spriteSize);
  const framePixels = spriteSize * spriteSize;
  let changedPixels = 0;

  for (let y = 0; y < spriteSize; y += 1) {
    for (let x = 0; x < spriteSize; x += 1) {
      const offsetA = pixelOffset(first.x + x, first.y + y, width);
      const offsetB = pixelOffset(second.x + x, second.y + y, width);

      const diff =
        Math.abs(data[offsetA] - data[offsetB]) +
        Math.abs(data[offsetA + 1] - data[offsetB + 1]) +
        Math.abs(data[offsetA + 2] - data[offsetB + 2]) +
        Math.abs(data[offsetA + 3] - data[offsetB + 3]);

      if (diff >= 40) {
        changedPixels += 1;
      }
    }
  }

  return changedPixels / Math.max(1, framePixels);
};

const quantizedColorKey = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

export const stabilizeSpriteSheet = async ({
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
  const totalSlots = columns * rows;
  const activeFrames = clamp(frameCount, 1, totalSlots);
  const innerInset = Math.max(2, Math.floor(spriteSize * 0.06));
  const frameInset = Math.max(innerInset, Math.floor(spriteSize * 0.01));
  const maxFrameContentSize = Math.max(2, spriteSize - 2 * frameInset);

  const boxes: Array<
    | {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
      }
    | null
  > = Array.from({ length: activeFrames }, () => null);

  const centersX: number[] = [];
  const centersY: number[] = [];
  let maxFrameDimension = 0;

  for (let frameIndex = 0; frameIndex < activeFrames; frameIndex += 1) {
    const origin = frameOrigin(frameIndex, columns, spriteSize);
    let minX = spriteSize;
    let minY = spriteSize;
    let maxX = -1;
    let maxY = -1;

    for (let localY = 0; localY < spriteSize; localY += 1) {
      for (let localX = 0; localX < spriteSize; localX += 1) {
        const offset = pixelOffset(origin.x + localX, origin.y + localY, width);
        if (alphaAt(data, offset) <= 16) continue;
        minX = Math.min(minX, localX);
        minY = Math.min(minY, localY);
        maxX = Math.max(maxX, localX);
        maxY = Math.max(maxY, localY);
      }
    }

    if (maxX < minX || maxY < minY) continue;

    const frameBox = {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1
    };
    boxes[frameIndex] = frameBox;
    maxFrameDimension = Math.max(maxFrameDimension, frameBox.width, frameBox.height);
    centersX.push((minX + maxX) / 2);
    centersY.push((minY + maxY) / 2);
  }

  if (centersX.length === 0) {
    return buffer;
  }

  const baseScale = Math.min(1, maxFrameContentSize / Math.max(1, maxFrameDimension));
  const paddedHalfContentX = clamp(Math.floor((maxFrameDimension * baseScale) / 2), 0, spriteSize / 2);
  const paddedHalfContentY = clamp(Math.floor((maxFrameDimension * baseScale) / 2), 0, spriteSize / 2);
  const safeCenterX = clamp(
    median(centersX),
    innerInset + paddedHalfContentX,
    Math.max(innerInset + paddedHalfContentX, spriteSize - innerInset - paddedHalfContentX)
  );
  const safeCenterY = clamp(
    median(centersY),
    innerInset + paddedHalfContentY,
    Math.max(innerInset + paddedHalfContentY, spriteSize - innerInset - paddedHalfContentY)
  );
  const output = Buffer.alloc(data.length, 0);
  // Keep original sprite detail; stabilize by translation first, not global shrink.
  for (let frameIndex = 0; frameIndex < activeFrames; frameIndex += 1) {
    const frameBox = boxes[frameIndex];
    if (!frameBox) continue;

    const origin = frameOrigin(frameIndex, columns, spriteSize);
    const scale = Math.min(1, baseScale);
    const scaledWidth = Math.max(1, Math.floor(frameBox.width * scale));
    const scaledHeight = Math.max(1, Math.floor(frameBox.height * scale));
    const availableDestinationX = spriteSize - scaledWidth;
    const insetBudgetX = Math.max(0, innerInset);
    const effectiveInsetX = Math.min(insetBudgetX, Math.floor(Math.max(0, availableDestinationX) / 2));
    const maxDestX = Math.max(0, availableDestinationX - effectiveInsetX);
    const availableDestinationY = spriteSize - scaledHeight;
    const insetBudgetY = Math.max(0, innerInset);
    const effectiveInsetY = Math.min(insetBudgetY, Math.floor(Math.max(0, availableDestinationY) / 2));
    const maxDestY = Math.max(0, availableDestinationY - effectiveInsetY);
    const destMinX = clamp(
      Math.round(safeCenterX - scaledWidth / 2),
      effectiveInsetX,
      maxDestX
    );
    const destMinY = clamp(
      Math.round(safeCenterY - scaledHeight / 2),
      effectiveInsetY,
      maxDestY
    );

    for (let localY = 0; localY < scaledHeight; localY += 1) {
      const sourceLocalY = Math.min(frameBox.height - 1, Math.floor(localY / Math.max(scale, 0.001)));
      for (let localX = 0; localX < scaledWidth; localX += 1) {
        const sourceLocalX = Math.min(frameBox.width - 1, Math.floor(localX / Math.max(scale, 0.001)));
        const sourceX = origin.x + frameBox.minX + sourceLocalX;
        const sourceY = origin.y + frameBox.minY + sourceLocalY;
        const sourceOffset = pixelOffset(sourceX, sourceY, width);
        const alpha = alphaAt(data, sourceOffset);
        if (alpha <= 16) continue;

        const destX = origin.x + destMinX + localX;
        const destY = origin.y + destMinY + localY;
        if (destX >= width || destY >= height) continue;
        const destOffset = pixelOffset(destX, destY, width);
        output[destOffset] = data[sourceOffset];
        output[destOffset + 1] = data[sourceOffset + 1];
        output[destOffset + 2] = data[sourceOffset + 2];
        output[destOffset + 3] = data[sourceOffset + 3];
      }
    }
  }

  return sharp(output, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
};

const scoreFromPenalties = ({
  reasons,
  thresholds,
  metrics,
  hasDimensionMismatch,
  hasTransparency
}: {
  reasons: string[];
  thresholds: QualityThresholds;
  metrics: QualityMetrics;
  hasDimensionMismatch: boolean;
  hasTransparency: boolean;
}) => {
  let score = 100;

  if (hasDimensionMismatch) score -= 28;
  if (!hasTransparency) score -= 24;

  if (metrics.transparentPixelRatio < thresholds.minTransparentRatio) {
    const deficit = (thresholds.minTransparentRatio - metrics.transparentPixelRatio) / thresholds.minTransparentRatio;
    score -= clamp(deficit * 20, 0, 20);
  }

  if (metrics.translucentPixelRatio > thresholds.maxTranslucentRatio) {
    const excess =
      (metrics.translucentPixelRatio - thresholds.maxTranslucentRatio) / Math.max(0.001, thresholds.maxTranslucentRatio);
    score -= clamp(excess * 18, 0, 18);
  }

  score -= clamp(metrics.outerEdgeOpaqueRatio * 90, 0, 18);

  if (metrics.maxBoundaryBleedRatio > thresholds.maxBoundaryBleedRatio) {
    const excess = metrics.maxBoundaryBleedRatio - thresholds.maxBoundaryBleedRatio;
    score -= clamp((excess / Math.max(0.01, 1 - thresholds.maxBoundaryBleedRatio)) * 14, 0, 14);
  }

  score -= Math.min(30, metrics.emptyFrameCount * 6);
  score -= Math.min(20, metrics.overcrowdedFrameCount * 4);
  score -= Math.min(30, metrics.clippedFrameCount * 5);

  if (metrics.maxAnchorDriftPx > thresholds.maxAnchorDriftPx) {
    const excess = metrics.maxAnchorDriftPx - thresholds.maxAnchorDriftPx;
    score -= clamp((excess / Math.max(1, thresholds.maxAnchorDriftPx)) * 16, 0, 16);
  }

  if (metrics.maxHorizontalDriftPx > thresholds.maxHorizontalDriftPx) {
    const excess = metrics.maxHorizontalDriftPx - thresholds.maxHorizontalDriftPx;
    score -= clamp((excess / Math.max(1, thresholds.maxHorizontalDriftPx)) * 10, 0, 10);
  }

  if (metrics.scaleVarianceRatio > thresholds.maxScaleVarianceRatio) {
    const excess = metrics.scaleVarianceRatio - thresholds.maxScaleVarianceRatio;
    score -= clamp((excess / Math.max(0.01, thresholds.maxScaleVarianceRatio)) * 12, 0, 12);
  }

  if (metrics.meanConsecutiveFrameDelta < thresholds.minMeanConsecutiveDelta) {
    const deficit =
      (thresholds.minMeanConsecutiveDelta - metrics.meanConsecutiveFrameDelta) /
      Math.max(0.001, thresholds.minMeanConsecutiveDelta);
    score -= clamp(deficit * 14, 0, 14);
  }

  if (metrics.distinctPairRatio < thresholds.minDistinctPairRatio) {
    const deficit =
      (thresholds.minDistinctPairRatio - metrics.distinctPairRatio) / Math.max(0.001, thresholds.minDistinctPairRatio);
    score -= clamp(deficit * 12, 0, 12);
  }

  if (metrics.quantizedColorCount < thresholds.minQuantizedColorCount) {
    const deficit =
      (thresholds.minQuantizedColorCount - metrics.quantizedColorCount) /
      Math.max(1, thresholds.minQuantizedColorCount);
    score -= clamp(deficit * 8, 0, 8);
  }

  if (metrics.quantizedColorCount > thresholds.maxQuantizedColorCount) {
    const excess =
      (metrics.quantizedColorCount - thresholds.maxQuantizedColorCount) /
      Math.max(1, thresholds.maxQuantizedColorCount);
    score -= clamp(excess * 8, 0, 8);
  }

  if (reasons.length === 0) {
    score = Math.max(score, thresholds.minScore);
  }

  return round(clamp(score, 0, 100), 1);
};

export const validateSpriteQuality = async ({
  buffer,
  spriteSize,
  columns,
  rows,
  frameCount,
  animationType,
  styleIntensity = 70,
  minScore = 82
}: QualityInput): Promise<QualityResult> => {
  const reasons: string[] = [];
  const expectedWidth = spriteSize * columns;
  const expectedHeight = spriteSize * rows;
  const totalSlots = columns * rows;
  const analyzedFrameCount = clamp(frameCount, 1, totalSlots);
  const frameArea = spriteSize * spriteSize;

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;

  const hasDimensionMismatch = width !== expectedWidth || height !== expectedHeight;
  if (hasDimensionMismatch) {
    reasons.push(`Image dimensions mismatch: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }

  const motionThresholds = motionThresholdForAnimation(animationType);
  const baseAnchorDriftPx = Math.max(3, Math.round(spriteSize * 0.16));
  const baseHorizontalDriftPx = Math.max(2, Math.round(spriteSize * 0.16));
  const driftToleranceMultiplier = motionThresholds.driftToleranceMultiplier;
  const perFrameColorBudget = clamp(Math.round(20 + styleIntensity * 0.2), 24, 44);
  const maxQuantizedColorCount = clamp(
    analyzedFrameCount * perFrameColorBudget,
    120,
    1600
  );
  const thresholds: QualityThresholds = {
    minScore,
    minTransparentRatio: 0.15,
    maxTranslucentRatio: 0.03,
    maxOuterEdgeOpaqueRatio: 0.16,
    maxBoundaryBleedRatio: 0.82,
    minFrameFillRatio: 0.015,
    maxFrameFillRatio: 0.72,
    maxAnchorDriftPx: Math.max(baseAnchorDriftPx, Math.round(baseAnchorDriftPx * driftToleranceMultiplier)),
    maxHorizontalDriftPx: Math.max(
      baseHorizontalDriftPx,
      Math.round(baseHorizontalDriftPx * driftToleranceMultiplier)
    ),
    maxScaleVarianceRatio: 0.45,
    minMeanConsecutiveDelta: motionThresholds.minMeanConsecutiveDelta,
    minDistinctPairRatio: motionThresholds.minDistinctPairRatio,
    minQuantizedColorCount: Math.max(20, Math.round(analyzedFrameCount * 3)),
    maxQuantizedColorCount
  };

  const frameSummaries: FrameQualitySummary[] = [];
  const quantizedColors = new Set<number>();

  let transparentPixels = 0;
  let translucentPixels = 0;

  for (let frameIndex = 0; frameIndex < analyzedFrameCount; frameIndex += 1) {
    const origin = frameOrigin(frameIndex, columns, spriteSize);
    let nonTransparentCount = 0;
    let translucentCount = 0;
    let centroidWeight = 0;
    let centroidXTotal = 0;
    let centroidYTotal = 0;
    let minX = spriteSize;
    let minY = spriteSize;
    let maxX = -1;
    let maxY = -1;
    let edgeLeft = 0;
    let edgeRight = 0;
    let edgeTop = 0;
    let edgeBottom = 0;

    for (let localY = 0; localY < spriteSize; localY += 1) {
      for (let localX = 0; localX < spriteSize; localX += 1) {
        const offset = pixelOffset(origin.x + localX, origin.y + localY, width);
        const alpha = alphaAt(data, offset);

        if (alpha <= 16) {
          transparentPixels += 1;
          continue;
        }

        nonTransparentCount += 1;
        if (alpha < 245) {
          translucentCount += 1;
          translucentPixels += 1;
        }

        const weight = alpha / 255;
        centroidWeight += weight;
        centroidXTotal += localX * weight;
        centroidYTotal += localY * weight;

        minX = Math.min(minX, localX);
        minY = Math.min(minY, localY);
        maxX = Math.max(maxX, localX);
        maxY = Math.max(maxY, localY);

        if (localX === 0) edgeLeft += 1;
        if (localX === spriteSize - 1) edgeRight += 1;
        if (localY === 0) edgeTop += 1;
        if (localY === spriteSize - 1) edgeBottom += 1;

        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        quantizedColors.add(quantizedColorKey(r, g, b));
      }
    }

    const fillRatio = nonTransparentCount / Math.max(1, frameArea);
    const translucentRatio = translucentCount / Math.max(1, frameArea);
    const bounds =
      maxX >= minX && maxY >= minY
        ? {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            area: (maxX - minX + 1) * (maxY - minY + 1)
          }
        : null;
    const clippedEdges: string[] = [];

    const sideEdgeThreshold = 0.08;
    const bottomEdgeThreshold = 0.22;
    if (edgeLeft / spriteSize > sideEdgeThreshold) clippedEdges.push("left");
    if (edgeRight / spriteSize > sideEdgeThreshold) clippedEdges.push("right");
    if (edgeTop / spriteSize > sideEdgeThreshold) clippedEdges.push("top");
    if (edgeBottom / spriteSize > bottomEdgeThreshold) clippedEdges.push("bottom");

    frameSummaries.push({
      frameIndex,
      fillRatio: round(fillRatio),
      translucentRatio: round(translucentRatio),
      centroidX: centroidWeight > 0 ? round(centroidXTotal / centroidWeight) : null,
      centroidY: centroidWeight > 0 ? round(centroidYTotal / centroidWeight) : null,
      clippedEdges,
      bounds
    });
  }

  const totalPixels = analyzedFrameCount * frameArea;
  const transparentPixelRatio = transparentPixels / Math.max(1, totalPixels);
  const translucentPixelRatio = translucentPixels / Math.max(1, totalPixels);
  const hasTransparency = transparentPixels > 0;
  if (!hasTransparency) {
    reasons.push("Missing transparent background");
  }

  if (transparentPixelRatio < thresholds.minTransparentRatio) {
    reasons.push(
      `Transparent coverage too low: ${Math.round(transparentPixelRatio * 100)}% (expected >= ${Math.round(
        thresholds.minTransparentRatio * 100
      )}%)`
    );
  }

  if (translucentPixelRatio > thresholds.maxTranslucentRatio) {
    reasons.push(
      `Too many semi-transparent pixels: ${Math.round(translucentPixelRatio * 100)}% (expected <= ${Math.round(
        thresholds.maxTranslucentRatio * 100
      )}%)`
    );
  }

  const outerEdgeOpaqueRatio = Math.max(
    opaqueRatioForColumn(data, width, height, 0),
    opaqueRatioForColumn(data, width, height, Math.max(0, width - 1)),
    opaqueRatioForRow(data, width, 0),
    opaqueRatioForRow(data, width, Math.max(0, height - 1))
  );

  if (outerEdgeOpaqueRatio > thresholds.maxOuterEdgeOpaqueRatio) {
    reasons.push(
      `Possible clipping on outer sheet edges (edge occupancy ${Math.round(outerEdgeOpaqueRatio * 100)}%, max ${Math.round(
        thresholds.maxOuterEdgeOpaqueRatio * 100
      )}%)`
    );
  }

  let maxBoundaryBleedRatio = 0;
  for (let c = 1; c < columns; c += 1) {
    const boundaryX = c * spriteSize;
    if (boundaryX > 0 && boundaryX < width) {
      maxBoundaryBleedRatio = Math.max(
        maxBoundaryBleedRatio,
        opaqueRatioForColumn(data, width, height, boundaryX - 1),
        opaqueRatioForColumn(data, width, height, boundaryX)
      );
    }
  }
  for (let r = 1; r < rows; r += 1) {
    const boundaryY = r * spriteSize;
    if (boundaryY > 0 && boundaryY < height) {
      maxBoundaryBleedRatio = Math.max(
        maxBoundaryBleedRatio,
        opaqueRatioForRow(data, width, boundaryY - 1),
        opaqueRatioForRow(data, width, boundaryY)
      );
    }
  }

  if (maxBoundaryBleedRatio > thresholds.maxBoundaryBleedRatio) {
    reasons.push(
      `Possible frame bleed at internal boundaries (${Math.round(maxBoundaryBleedRatio * 100)}%, max ${Math.round(
        thresholds.maxBoundaryBleedRatio * 100
      )}%)`
    );
  }

  const emptyFrames = frameSummaries.filter((frame) => frame.fillRatio < thresholds.minFrameFillRatio);
  const overcrowdedFrames = frameSummaries.filter((frame) => frame.fillRatio > thresholds.maxFrameFillRatio);
  const clippedFrames = frameSummaries.filter((frame) => frame.clippedEdges.length > 0);

  if (emptyFrames.length > 0) {
    reasons.push(
      `Detected ${emptyFrames.length} nearly empty frames (${emptyFrames
        .slice(0, 8)
        .map((frame) => frame.frameIndex)
        .join(", ")})`
    );
  }

  if (overcrowdedFrames.length > 0) {
    reasons.push(
      `Detected ${overcrowdedFrames.length} overcrowded frames that likely violate margins (${overcrowdedFrames
        .slice(0, 8)
        .map((frame) => frame.frameIndex)
        .join(", ")})`
    );
  }

  if (clippedFrames.length > 0) {
    reasons.push(
      `Detected ${clippedFrames.length} frames touching frame edges (${clippedFrames
        .slice(0, 8)
        .map((frame) => frame.frameIndex)
        .join(", ")})`
    );
  }

  const centroids = frameSummaries.filter((frame) => frame.centroidX !== null && frame.centroidY !== null);
  let maxAnchorDriftPx = 0;
  let maxHorizontalDriftPx = 0;
  let maxVerticalDriftPx = 0;

  if (centroids.length > 1) {
    // Use the median centroid as the anchor reference to avoid penalizing cyclic motion.
    const baseX = median(centroids.map((frame) => frame.centroidX ?? 0));
    const baseY = median(centroids.map((frame) => frame.centroidY ?? 0));

    for (const frame of centroids) {
      const dx = (frame.centroidX ?? 0) - baseX;
      const dy = (frame.centroidY ?? 0) - baseY;
      maxHorizontalDriftPx = Math.max(maxHorizontalDriftPx, Math.abs(dx));
      maxVerticalDriftPx = Math.max(maxVerticalDriftPx, Math.abs(dy));
      maxAnchorDriftPx = Math.max(maxAnchorDriftPx, Math.sqrt(dx * dx + dy * dy));
    }
  }

  if (maxAnchorDriftPx > thresholds.maxAnchorDriftPx) {
    reasons.push(
      `Anchor drift too high (${round(maxAnchorDriftPx, 2)}px, max ${thresholds.maxAnchorDriftPx}px). Keep character centered.`
    );
  }

  if (maxHorizontalDriftPx > thresholds.maxHorizontalDriftPx) {
    reasons.push(
      `Horizontal drift too high (${round(maxHorizontalDriftPx, 2)}px, max ${thresholds.maxHorizontalDriftPx}px).`
    );
  }

  const boundingAreas = frameSummaries.map((frame) => frame.bounds?.area ?? 0).filter((area) => area > 0);
  let scaleVarianceRatio = 0;
  if (boundingAreas.length > 1) {
    const maxArea = Math.max(...boundingAreas);
    const minArea = Math.min(...boundingAreas);
    scaleVarianceRatio = (maxArea - minArea) / Math.max(1, maxArea);
  }

  if (scaleVarianceRatio > thresholds.maxScaleVarianceRatio) {
    reasons.push(
      `Scale variation too high across frames (${Math.round(scaleVarianceRatio * 100)}%, max ${Math.round(
        thresholds.maxScaleVarianceRatio * 100
      )}%)`
    );
  }

  const consecutiveDeltas: number[] = [];
  for (let index = 0; index < analyzedFrameCount - 1; index += 1) {
    consecutiveDeltas.push(
      computeConsecutiveFrameDelta({
        data,
        width,
        columns,
        spriteSize,
        firstFrame: index,
        secondFrame: index + 1
      })
    );
  }

  const meanConsecutiveFrameDelta =
    consecutiveDeltas.length > 0
      ? consecutiveDeltas.reduce((sum, value) => sum + value, 0) / consecutiveDeltas.length
      : 0;
  const minConsecutiveFrameDelta = consecutiveDeltas.length > 0 ? Math.min(...consecutiveDeltas) : 0;
  const maxConsecutiveFrameDelta = consecutiveDeltas.length > 0 ? Math.max(...consecutiveDeltas) : 0;
  const distinctDeltaThreshold = Math.max(0.006, thresholds.minMeanConsecutiveDelta * 0.75);
  const distinctPairRatio =
    consecutiveDeltas.length > 0
      ? consecutiveDeltas.filter((delta) => delta >= distinctDeltaThreshold).length / consecutiveDeltas.length
      : 1;

  if (consecutiveDeltas.length > 0 && meanConsecutiveFrameDelta < thresholds.minMeanConsecutiveDelta) {
    reasons.push(
      `Animation motion is too low (${Math.round(meanConsecutiveFrameDelta * 1000) / 10}% mean frame delta, min ${Math.round(
        thresholds.minMeanConsecutiveDelta * 1000
      ) / 10}%)`
    );
  }

  if (consecutiveDeltas.length > 0 && distinctPairRatio < thresholds.minDistinctPairRatio) {
    reasons.push(
      `Too many near-duplicate consecutive frames (${Math.round(distinctPairRatio * 100)}% distinct pairs, min ${Math.round(
        thresholds.minDistinctPairRatio * 100
      )}%)`
    );
  }

  const quantizedColorCount = quantizedColors.size;
  if (quantizedColorCount < thresholds.minQuantizedColorCount) {
    reasons.push(
      `Color diversity too low (${quantizedColorCount} quantized colors, min ${thresholds.minQuantizedColorCount})`
    );
  }
  if (quantizedColorCount > thresholds.maxQuantizedColorCount) {
    reasons.push(
      `Color diversity too high for crisp pixel art (${quantizedColorCount} quantized colors, max ${thresholds.maxQuantizedColorCount})`
    );
  }

  const metrics: QualityMetrics = {
    analyzedFrameCount,
    expectedFrameCount: frameCount,
    transparentPixelRatio: round(transparentPixelRatio),
    translucentPixelRatio: round(translucentPixelRatio),
    quantizedColorCount,
    outerEdgeOpaqueRatio: round(outerEdgeOpaqueRatio),
    maxBoundaryBleedRatio: round(maxBoundaryBleedRatio),
    emptyFrameCount: emptyFrames.length,
    overcrowdedFrameCount: overcrowdedFrames.length,
    clippedFrameCount: clippedFrames.length,
    maxAnchorDriftPx: round(maxAnchorDriftPx),
    maxHorizontalDriftPx: round(maxHorizontalDriftPx),
    maxVerticalDriftPx: round(maxVerticalDriftPx),
    scaleVarianceRatio: round(scaleVarianceRatio),
    meanConsecutiveFrameDelta: round(meanConsecutiveFrameDelta),
    minConsecutiveFrameDelta: round(minConsecutiveFrameDelta),
    maxConsecutiveFrameDelta: round(maxConsecutiveFrameDelta),
    distinctPairRatio: round(distinctPairRatio)
  };

  const score = scoreFromPenalties({
    reasons,
    thresholds,
    metrics,
    hasDimensionMismatch,
    hasTransparency
  });

  if (score < minScore) {
    reasons.push(`Quality score ${score.toFixed(1)} is below minimum ${minScore.toFixed(1)}`);
  }

  const diagnostics: QualityDiagnostics = {
    score,
    thresholds,
    metrics,
    frameSummaries
  };

  return {
    ok: reasons.length === 0 && score >= minScore,
    reasons,
    width,
    height,
    diagnostics
  };
};

export const verifyImageAgainstRequestedSettings = async ({
  buffer,
  spriteSize,
  frameCount,
  columns,
  rows
}: {
  buffer: Buffer;
  spriteSize: number;
  frameCount: number;
  columns: number;
  rows: number;
}): Promise<SettingsVerificationResult> => {
  const expectedSheetWidth = spriteSize * columns;
  const expectedSheetHeight = spriteSize * rows;

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sheetWidth = info.width;
  const sheetHeight = info.height;
  const frameSlots = columns * rows;

  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      hasTransparency = true;
      break;
    }
  }

  const frameWidth = Math.floor(sheetWidth / Math.max(1, columns));
  const frameHeight = Math.floor(sheetHeight / Math.max(1, rows));

  let nonEmptyFrameCount = 0;
  let unusedSlotsWithContent = 0;
  for (let frameIndex = 0; frameIndex < frameSlots; frameIndex += 1) {
    const origin = frameOrigin(frameIndex, columns, spriteSize);
    let hasVisiblePixel = false;
    for (let localY = 0; localY < spriteSize && !hasVisiblePixel; localY += 1) {
      for (let localX = 0; localX < spriteSize; localX += 1) {
        const x = origin.x + localX;
        const y = origin.y + localY;
        if (x >= sheetWidth || y >= sheetHeight) continue;
        const offset = pixelOffset(x, y, sheetWidth);
        if (alphaAt(data, offset) > 16) {
          hasVisiblePixel = true;
          break;
        }
      }
    }

    if (hasVisiblePixel) {
      nonEmptyFrameCount += 1;
      if (frameIndex >= frameCount) {
        unusedSlotsWithContent += 1;
      }
    }
  }

  const failures: string[] = [];
  if (sheetWidth !== expectedSheetWidth) {
    failures.push(`sheet width ${sheetWidth}px does not match requested ${expectedSheetWidth}px`);
  }
  if (sheetHeight !== expectedSheetHeight) {
    failures.push(`sheet height ${sheetHeight}px does not match requested ${expectedSheetHeight}px`);
  }
  if (sheetWidth % columns !== 0) {
    failures.push(`sheet width ${sheetWidth}px is not divisible by columns ${columns}`);
  }
  if (sheetHeight % rows !== 0) {
    failures.push(`sheet height ${sheetHeight}px is not divisible by rows ${rows}`);
  }
  if (frameWidth !== spriteSize) {
    failures.push(`frame width ${frameWidth}px does not match requested ${spriteSize}px`);
  }
  if (frameHeight !== spriteSize) {
    failures.push(`frame height ${frameHeight}px does not match requested ${spriteSize}px`);
  }
  if (frameSlots < frameCount) {
    failures.push(`layout capacity ${frameSlots} is below requested frame count ${frameCount}`);
  }
  if (nonEmptyFrameCount < frameCount) {
    failures.push(`only ${nonEmptyFrameCount} non-empty frames detected for requested ${frameCount} frames`);
  }
  if (unusedSlotsWithContent > 0) {
    failures.push(`${unusedSlotsWithContent} unused frame slots contain sprite content`);
  }
  if (!hasTransparency) {
    failures.push("image is not RGBA transparent as requested");
  }

  return {
    passed: failures.length === 0,
    summary: failures.length === 0 ? "Image meets or exceeds requested settings." : "Image does not meet requested settings.",
    failures,
    checks: {
      expected: {
        frameWidth: spriteSize,
        frameHeight: spriteSize,
        frameCount,
        columns,
        rows,
        sheetWidth: expectedSheetWidth,
        sheetHeight: expectedSheetHeight
      },
      actual: {
        frameWidth,
        frameHeight,
        frameSlots,
        sheetWidth,
        sheetHeight,
        hasTransparency,
        nonEmptyFrameCount,
        unusedSlotsWithContent
      }
    }
  };
};
