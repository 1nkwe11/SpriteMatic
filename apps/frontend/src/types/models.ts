export type User = {
  id: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
};

export type Projection = "2D" | "isometric";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";

export type SpriteJsonConfig = {
  kind: "sprite-sheet";
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  animations: Record<
    string,
    {
      start: number;
      end: number;
      loop: boolean;
    }
  >;
  verification?: {
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
  quality?: {
    score: number;
    thresholds: {
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
    metrics: {
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
    frameSummaries: Array<{
      frameIndex: number;
      fillRatio: number;
      translucentRatio: number;
      centroidX: number | null;
      centroidY: number | null;
      clippedEdges: string[];
      bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
        area: number;
      } | null;
    }>;
  };
};

export type Generation = {
  id: string;
  status: GenerationStatus;
  frameCount: number;
  spriteSize: number;
  projection: Projection;
  animationType: string;
  columns: number;
  rows: number;
  createdAt: string;
  imageUrl?: string;
  jsonConfig?: SpriteJsonConfig;
  qualityWarnings: string[];
  errorReason?: string | null;
  seed?: number | null;
  modelVersion: string;
  settingsVerification?: {
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
  promptTokens?: number;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedOutputTokens?: number;
  estimatedCostUsd?: number | null;
  qualityDiagnostics?: SpriteJsonConfig["quality"];
};

export type GenerateSpriteRequest = {
  prompt: string;
  spriteSize: number;
  frameCount: number;
  projection: Projection;
  animationType: string;
  styleIntensity: number;
  layout: "row" | "grid";
  columns?: number;
  seed?: number;
  model?: string;
};

export type GenerateSpriteResponse =
  | {
      queued: true;
      jobId: string | number;
      generationId: string;
    }
  | {
      queued: false;
      cacheHit?: boolean;
      generation: Generation;
    };
