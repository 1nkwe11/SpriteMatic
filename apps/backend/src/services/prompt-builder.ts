export type ProjectionInput = "2D" | "isometric";

export type PromptBuildInput = {
  themePrompt: string;
  spriteSize: number;
  frameCount: number;
  projection: ProjectionInput;
  animationType: string;
  styleIntensity: number;
  columns: number;
  rows: number;
  seed?: number;
  compact?: boolean;
};

const styleDescription = (styleIntensity: number, compact: boolean) => {
  if (styleIntensity >= 85) {
    return compact ? "highly stylized, bold contrast" : "highly stylized silhouette, bold shape language, strong contrast";
  }
  if (styleIntensity >= 65) {
    return compact ? "stylized, readable forms" : "stylized but readable forms, clear silhouette, punchy color separation";
  }
  if (styleIntensity >= 45) {
    return compact ? "balanced stylization, readable" : "balanced stylization with clear readability";
  }
  if (styleIntensity >= 25) {
    return compact ? "subtle stylization" : "subtle stylization with restrained details";
  }
  return compact ? "minimal stylization" : "minimal stylization and conservative detail";
};

const normalizeThemePrompt = (theme: string, compact: boolean) => {
  const normalized = theme.trim().replace(/\s+/g, " ");
  const maxLength = compact ? 150 : 180;
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

const buildFrameCoverageGuidance = ({
  frameCount,
  spriteSize,
  columns,
  animationType,
  compact
}: {
  frameCount: number;
  spriteSize: number;
  columns: number;
  animationType: string;
  compact: boolean;
}) => {
  const lowerAnimationType = animationType.toLowerCase();
  const sequenceHint =
    lowerAnimationType.includes("walk")
      ? "Walk cycle sequence: every frame should show a leg and arm progression from left to right in time."
      : "Animation sequence: each frame should be a smooth progression from the previous frame.";
  const fillRequirement =
    "All frame slots must contain the character with visible non-empty silhouette and no blank frame substitutions.";

  if (frameCount <= 1) {
    return compact ? `${fillRequirement} Populate every frame slot.` : `Populate the only frame with the full character. ${fillRequirement}`;
  }

  const frameInstructions = Array.from({ length: Math.min(frameCount, 16) }, (_, frameIndex) => {
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    const x0 = column * spriteSize;
    const x1 = (column + 1) * spriteSize - 1;
    const y0 = row * spriteSize;
    const y1 = (row + 1) * spriteSize - 1;
    return `frame ${frameIndex}: x ${x0}-${x1}, y ${y0}-${y1}`;
  });

  if (compact) {
    return `${fillRequirement} Use every frame slot: ${frameInstructions.join(", ")}.`;
  }

  const extras = frameCount > 16 ? "; ... additional frames continue sequentially" : "";
  return `Populate every one of the ${frameCount} frame slots, keep a consistent pose progression, and avoid blank frames. ${sequenceHint} ${frameInstructions.join("; ")}${extras}.`;
};

const parseFlaggedFrameIndices = (issues: string[]) => {
  const allIndices = new Set<number>();
  for (const issue of issues) {
    const match = issue.match(/detected .*?frames .*?\(([^)]+)\)/i);
    if (!match || match.length < 2) continue;

    match[1]
      .split(",")
      .map((raw) => Number.parseInt(raw.trim(), 10))
      .forEach((index) => {
        if (Number.isFinite(index) && index >= 0 && index < 1000) {
          allIndices.add(index);
        }
      });
  }

  const sorted = Array.from(allIndices).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : null;
};

const compactIssue = (issue: string) => {
  const normalized = issue.trim().replace(/\s+/g, " ");
  if (!normalized) return "Quality mismatch on generated output.";

  const lower = normalized.toLowerCase();
  if (lower.includes("frame width")) return "Frame geometry mismatch.";
  if (lower.includes("frame height")) return "Frame geometry mismatch.";
  if (lower.includes("frame count")) return "Frame count mismatch.";
  if (lower.includes("capacity")) return "Layout capacity mismatch.";
  if (lower.includes("sheet width") || lower.includes("sheet height")) return "Sheet dimension mismatch.";
  if (lower.includes("transparent")) return "Transparency requirement not met.";
  if (lower.includes("clipping") || lower.includes("bleed")) return "Boundary clipping or bleed detected.";
  if (lower.includes("anchor drift") || lower.includes("horizontal drift")) return "Anchor stability issue.";
  if (lower.includes("motion")) return "Animation motion quality too weak.";
  if (lower.includes("color") || lower.includes("palette") || lower.includes("quantized"))
    return "Color complexity outside target range.";

  const maxLength = 90;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

export const buildSpritePrompt = ({
  themePrompt,
  frameCount,
  spriteSize,
  projection,
  animationType,
  styleIntensity,
  columns,
  rows,
  seed,
  compact = false
}: PromptBuildInput) => {
  const sheetWidth = spriteSize * columns;
  const sheetHeight = spriteSize * rows;
  const styleNotes = styleDescription(styleIntensity, compact);
  const compactTheme = normalizeThemePrompt(themePrompt, compact);
  const seedLine = `seed=${seed ?? "auto"}`;
  const frameCoverageGuidance = buildFrameCoverageGuidance({
    frameCount,
    spriteSize,
    columns,
    animationType,
    compact
  });

  const strictTemplate = compact
    ? [
        `Pixel-art sprite-sheet PNG with transparent background (${sheetWidth}x${sheetHeight}px, ${columns}x${rows} grid, ${spriteSize}x${spriteSize} frames, ${frameCount} frames).`,
        "Use true pixel art only: hard 1px edges, no antialiasing, blur, gradients, interpolation, text, border, guides, UI, or watermark.",
        `Projection ${projection}. Animation ${animationType}. Style ${styleIntensity}/100 (${styleNotes}).`,
        "Lock torso/hips to frame center and keep feet on a stable baseline in every frame. No camera pan, zoom, or pose translation.",
        "Populate every frame with the character and ensure each frame is different enough from the previous one.",
        "Use a coherent limited palette (roughly 16-48 colors for the character) and clean pixel clusters.",
        frameCoverageGuidance,
        `Theme: ${compactTheme}`,
        seedLine
      ]
    : [
        "Task: create one transparent pixel-art sprite-sheet PNG.",
        `Canvas: ${sheetWidth}x${sheetHeight}px, ${columns}x${rows} grid, ${spriteSize}x${spriteSize} frames, ${frameCount} total frames.`,
      "Use true pixel-art rendering only: hard 1px pixel edges, no antialiasing, blur, gradients, interpolation, text, guides, borders, UI, or watermark.",
      "Character consistency: same character identity, proportions, facing, and silhouette across all frames.",
      "Anchor lock: keep torso/hips centered in each frame, keep feet on a stable baseline, and animate mainly limbs/secondary motion.",
      "Every frame in the sheet must contain the character; avoid any nearly empty or blank frames.",
      frameCoverageGuidance,
      "Character and motion must stay within each frame cell; maintain at least a small inset so no opaque pixels touch any frame border.",
      "Keep fixed camera and fixed scale; avoid clipping and out-of-bounds movement.",
        `Projection:${projection}. Animation:${animationType}. Style:${styleIntensity}/100 (${styleNotes}).`,
        "Palette/style target: coherent limited palette (about 16-48 colors), clean pixel clusters, readable silhouette, no painterly texture.",
        "Frame budget: obey exact geometry first if conflicts occur.",
        `Theme:${compactTheme}`,
        seedLine
      ];

  return strictTemplate.join("\n");
};

export const buildQualityCorrectionPrompt = ({
  basePrompt,
  attempt,
  maxAttempts,
  issues,
  compact = false,
  issueLimit
}: {
  basePrompt: string;
  attempt: number;
  maxAttempts: number;
  issues: string[];
  compact?: boolean;
  issueLimit?: number;
}) => {
  const hasAnchorStabilityIssue = issues.some((issue) =>
    /(anchor drift|horizontal drift|anchor stability|keep character centered)/i.test(issue)
  );
  const hasEmptyFrameIssue = issues.some((issue) =>
    /(empty frame|blank frame|nearly empty|only \d+ non-empty frames)/i.test(issue)
  );
  const hasClippingIssue = issues.some(
    (issue) =>
      /(clipping|bleed|touching frame edges|frame edges|outer sheet edges|frame bleed)/i.test(issue)
  );
  const flaggedEmptyFrames = hasEmptyFrameIssue ? parseFlaggedFrameIndices(issues) : null;
  const normalizedIssueLimit = Number.isFinite(issueLimit) ? Math.max(1, Math.trunc(issueLimit!)) : compact ? 2 : 4;
  const safeIssues = issues.length > 0
    ? issues.slice(0, normalizedIssueLimit).map(compactIssue)
    : ["General quality did not pass automated checks."];
  const conciseBasePrompt = basePrompt
    .split(/\r?\n/)
    .slice(0, compact ? 2 : 4)
    .filter(Boolean)
    .join(" | ")
    .trim();
  const maxBaseLength = compact ? 170 : 250;
  const compactBase =
    conciseBasePrompt.length > maxBaseLength ? `${conciseBasePrompt.slice(0, maxBaseLength).trimEnd()}…` : conciseBasePrompt;

  const correctionTemplate = [
    compactBase,
    "",
    `Correction pass ${attempt}/${maxAttempts}: keep character and layout identical, then address listed defects.`,
    "Prioritize exact frame count/size, clipping cleanup, anchor stability, and transparent background.",
    ...(hasEmptyFrameIssue ? ["Every frame must be visibly non-empty; regenerate all frames, not only a subset."] : []),
    ...(hasEmptyFrameIssue && flaggedEmptyFrames
      ? [
          `Empty/blank frames to fix: ${flaggedEmptyFrames.join(", ")}. Fill each flagged slot with a distinct pose in the same animation continuity.`
        ]
      : []),
    ...(hasClippingIssue
      ? ["Leave a visible inset from frame edges in all frames; redraw with no character pixels touching any frame boundary."]
      : []),
    "Render correction as crisp pixel clusters with limited palette; avoid painterly or airbrushed shading.",
    ...(hasAnchorStabilityIssue
      ? ["Anchor lock: keep torso/pelvis at the same frame center in every frame; only limbs should move around it."]
      : []),
    "",
    "Fix:",
    ...safeIssues.map((issue) => `- ${issue}`),
    "",
    "Regenerate one full sprite sheet with the same constraints."
  ];

  return correctionTemplate.join("\n");
};
