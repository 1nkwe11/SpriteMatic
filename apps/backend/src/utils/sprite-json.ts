export type SpriteJsonInput = {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  animationType: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedOutputTokens: number;
  };
  verification?: unknown;
  quality?: unknown;
};

export const buildSpriteSheetJson = ({
  frameWidth,
  frameHeight,
  columns,
  rows,
  frameCount,
  animationType,
  tokenUsage,
  verification,
  quality
}: SpriteJsonInput) => ({
  kind: "sprite-sheet",
  frameWidth,
  frameHeight,
  columns,
  rows,
  animations: {
    [animationType]: {
      start: 0,
      end: Math.max(0, frameCount - 1),
      loop: true
    }
  },
  ...(verification ? { verification } : {}),
  ...(quality ? { quality } : {}),
  ...(tokenUsage
    ? {
        tokenUsage: {
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          estimatedOutputTokens: tokenUsage.estimatedOutputTokens
        }
      }
    : {})
});
