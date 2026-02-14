import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGenerationStore } from "../stores/generation-store";
import { formatModelLabelWithCost, MODEL_RATES } from "../constants/modelRates";
import type { Projection } from "../types/models";

const spriteSizeTiers = [32, 64, 128] as const;
const frameCountTiers = [
  { value: 4, label: "Simple loops", detail: "Minimal motion" },
  { value: 8, label: "Low detail", detail: "Basic cycle" },
  { value: 16, label: "Medium detail", detail: "Clean motion arcs" },
  { value: 24, label: "High detail", detail: "Smooth animation" },
  { value: 32, label: "Advanced detail", detail: "Secondary motion" },
  { value: 48, label: "Cinematic detail", detail: "Near-fluid motion" },
  { value: 64, label: "Ultra detail", detail: "Showcase smoothness" }
] as const;
const animationOptions = [
  { value: "idle", label: "Idle" },
  { value: "walk", label: "Walk" },
  { value: "run", label: "Run" },
  { value: "attack", label: "Attack" },
  { value: "jump", label: "Jump" },
  { value: "cast", label: "Cast" }
] as const;
const styleProfiles = [
  { label: "Muted", value: 20, description: "Subtle palette and low stylization" },
  { label: "Balanced", value: 45, description: "Natural style with readable features" },
  { label: "Stylized", value: 70, description: "Distinct shapes and stronger identity" },
  { label: "Expressive", value: 85, description: "Bold forms and dynamic silhouette" },
  { label: "Extreme", value: 100, description: "Maximum stylization and contrast" }
] as const;

const normalizePrompt = (value: string) => value.trim().replace(/\s+/g, " ");
const estimateTokens = (text: string) => {
  const normalized = normalizePrompt(text);
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
};

const estimatePromptCost = ({
  model,
  inputTokens,
  outputTokens = 0
}: {
  model: string;
  inputTokens: number;
  outputTokens?: number;
}) => {
  const rates = MODEL_RATES[model];
    if (!rates) return null;
  const inputCost = (inputTokens / 1_000_000) * rates.inputPerMTokens;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPerMTokens;
  return Number((inputCost + outputCost).toFixed(4));
};

const estimateOutputTokens = ({
  spriteSize,
  columns,
  rows
}: {
  spriteSize: number;
  columns: number;
  rows: number;
}) => {
  const sheetPixels = spriteSize * spriteSize * columns * rows;
  return Math.min(Math.max(Math.round(sheetPixels / 20), 512), 12000);
};

type LayoutPreset = {
  id: string;
  label: string;
  columns: number;
  rows: number;
  category: "row" | "square";
};

const layoutPresets: LayoutPreset[] = [
  { id: "row-1", label: "1x1", columns: 1, rows: 1, category: "row" },
  { id: "row-2", label: "1x2", columns: 2, rows: 1, category: "row" },
  { id: "row-3", label: "1x3", columns: 3, rows: 1, category: "row" },
  { id: "row-4", label: "1x4", columns: 4, rows: 1, category: "row" },
  { id: "row-5", label: "1x5", columns: 5, rows: 1, category: "row" },
  { id: "row-6", label: "1x6", columns: 6, rows: 1, category: "row" },
  { id: "row-7", label: "1x7", columns: 7, rows: 1, category: "row" },
  { id: "row-8", label: "1x8", columns: 8, rows: 1, category: "row" },
  { id: "sq-1", label: "1x1", columns: 1, rows: 1, category: "square" },
  { id: "sq-2", label: "2x2", columns: 2, rows: 2, category: "square" },
  { id: "sq-3", label: "3x3", columns: 3, rows: 3, category: "square" },
  { id: "sq-4", label: "4x4", columns: 4, rows: 4, category: "square" },
  { id: "sq-5", label: "5x5", columns: 5, rows: 5, category: "square" },
  { id: "sq-6", label: "6x6", columns: 6, rows: 6, category: "square" },
  { id: "sq-7", label: "7x7", columns: 7, rows: 7, category: "square" },
  { id: "sq-8", label: "8x8", columns: 8, rows: 8, category: "square" }
];

const modelOptions = [
  { value: "gpt-4.1-nano", label: formatModelLabelWithCost("gpt-4.1-nano") },
  { value: "gpt-4.1-mini", label: formatModelLabelWithCost("gpt-4.1-mini") },
  { value: "gpt-4.1", label: formatModelLabelWithCost("gpt-4.1") },
  { value: "gpt-4o-mini", label: formatModelLabelWithCost("gpt-4o-mini") },
  { value: "gpt-4o", label: formatModelLabelWithCost("gpt-4o") },
  { value: "gpt-image-1", label: formatModelLabelWithCost("gpt-image-1") }
];

export const GeneratorPage = () => {
  const navigate = useNavigate();
  const generate = useGenerationStore((state) => state.generate);
  const loading = useGenerationStore((state) => state.loading);
  const [error, setError] = useState<string | null>(null);
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<number | null>(null);

  const [spriteSizeIndex, setSpriteSizeIndex] = useState(1);
  const [frameCount, setFrameCount] = useState(8);
  const [animationType, setAnimationType] = useState("walk");
  const [projection, setProjection] = useState<Projection>("2D");
  const [styleIndex, setStyleIndex] = useState(2);
  const [layoutPresetId, setLayoutPresetId] = useState("row-8");
  const [prompt, setPrompt] = useState("rogue fox adventurer with lantern and cape");
  const [seed, setSeed] = useState<number | "">("");
  const defaultModel = modelOptions[0].value;
  const [model, setModel] = useState(defaultModel);

  const spriteSize = spriteSizeTiers[spriteSizeIndex];
  const styleIntensity = styleProfiles[styleIndex].value;
  const selectedLayout = useMemo(
    () => layoutPresets.find((preset) => preset.id === layoutPresetId) ?? layoutPresets[7],
    [layoutPresetId]
  );
  const layoutCapacity = selectedLayout.columns * selectedLayout.rows;
  const availableFrameTiers = useMemo(
    () => frameCountTiers.filter((tier) => tier.value <= layoutCapacity),
    [layoutCapacity]
  );
  const selectedFrameTier = useMemo(
    () => frameCountTiers.find((tier) => tier.value === frameCount) ?? frameCountTiers[1],
    [frameCount]
  );
  const estimatedPromptText = useMemo(() => {
    const frameCanvasWidth = spriteSize * selectedLayout.columns;
    const frameCanvasHeight = spriteSize * selectedLayout.rows;
    const style = styleProfiles[styleIndex].value;
    const normalizedTheme = normalizePrompt(prompt);
    const compactTheme =
      normalizedTheme.length > 240 ? `${normalizedTheme.slice(0, 240).trimEnd()}…` : normalizedTheme;

    return [
      "Task: create one transparent pixel-art sprite-sheet PNG.",
      `Canvas: ${frameCanvasWidth}x${frameCanvasHeight}px, ${selectedLayout.columns}x${selectedLayout.rows} grid, ${spriteSize}x${spriteSize} frames, ${frameCount} total frames.`,
      "Use nearest-neighbor style only: hard pixels, no antialiasing, blur, gradients, interpolation, guides, borders, or watermark.",
      `Projection:${projection}. Animation:${animationType}. Style:${style}/100.`,
      `Frame budget: obey exact geometry first if conflicts occur.`,
      `Theme:${compactTheme}`
    ].join("\n");
  }, [projection, spriteSize, selectedLayout.columns, selectedLayout.rows, frameCount, animationType, styleIndex, prompt]);
  const estimatedPromptTokens = useMemo(() => estimateTokens(estimatedPromptText), [estimatedPromptText]);
  const selectedModelRate = MODEL_RATES[model] ?? null;
  const estimatedOutputTokensPerAttempt = useMemo(
    () =>
      estimateOutputTokens({
        spriteSize,
        columns: selectedLayout.columns,
        rows: selectedLayout.rows
      }),
    [selectedLayout.columns, selectedLayout.rows, spriteSize]
  );
  const attemptsForEstimate = selectedModelRate?.maxAttempts ?? 3;
  const estimatedCostUsd = useMemo(
    () =>
      estimatePromptCost({
        model,
        inputTokens: estimatedPromptTokens * attemptsForEstimate,
        outputTokens: estimatedOutputTokensPerAttempt * attemptsForEstimate
      }),
    [attemptsForEstimate, estimatedOutputTokensPerAttempt, model, estimatedPromptTokens]
  );

  useEffect(() => {
    if (availableFrameTiers.length === 0) return;
    if (!availableFrameTiers.some((tier) => tier.value === frameCount)) {
      setFrameCount(availableFrameTiers[availableFrameTiers.length - 1].value);
    }
  }, [availableFrameTiers, frameCount]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  const progressStage = useMemo(() => {
    if (progress < 34) {
      return {
        label: "Building prompt",
        animation: (
          <div className="grid h-20 w-20 place-items-center rounded-2xl border border-white/20 bg-white/5">
            <div className="h-9 w-9 rounded-full border-4 border-[var(--brand-sand)] border-r-transparent animate-spin" />
          </div>
        )
      };
    }

    if (progress < 67) {
      return {
        label: "Rendering frames",
        animation: (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-5 w-5 rounded-sm bg-[var(--brand-coral)]/90 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )
      };
    }

    return {
      label: "Finalizing sprite sheet",
      animation: (
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-2xl border border-[var(--brand-sand)]/60 animate-pulse" />
          <div className="absolute inset-2 rounded-xl border border-[var(--brand-coral)]/80 animate-ping" />
          <div className="absolute inset-5 rounded-md bg-[var(--brand-sand)] animate-bounce" />
        </div>
      )
    };
  }, [progress]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (availableFrameTiers.length === 0) {
      setError("Selected layout cannot fit the minimum frame count tier (4). Choose a larger layout.");
      return;
    }

    setShowLoadingScreen(true);
    setProgress(3);

    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
    }

    progressTimerRef.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        if (current < 30) return current + 4;
        if (current < 70) return current + 2;
        return current + 1;
      });
    }, 350);

    try {
      const result = await generate({
        prompt,
        spriteSize,
        frameCount,
        animationType,
        projection,
        styleIntensity,
        layout: "grid",
        columns: selectedLayout.columns,
        seed: seed === "" ? undefined : seed,
        model
      });

      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 320));
      navigate(`/results/${result.generationId}`);
    } catch (err) {
      if (progressTimerRef.current !== null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setShowLoadingScreen(false);
      setProgress(0);
      setError(err instanceof Error ? err.message : "Generation failed.");
    }
  };

  return (
    <>
      <section className="rounded-3xl border border-white/15 bg-black/20 p-6">
        <h1 className="font-display text-4xl text-[var(--ink-100)]">Sprite Generator</h1>
        <p className="mt-2 text-sm text-[var(--ink-200)]">
          Configure frame layout, projection, animation type, and style intensity for a production-ready sprite sheet.
        </p>

        <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Sprite size</span>
            <div className="rounded-xl border border-white/20 bg-black/20 p-3">
              <input
                type="range"
                min={0}
                max={spriteSizeTiers.length - 1}
                step={1}
                value={spriteSizeIndex}
                onChange={(event) => setSpriteSizeIndex(Number(event.target.value))}
                className="w-full accent-[var(--brand-sand)]"
              />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {spriteSizeTiers.map((size, index) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSpriteSizeIndex(index)}
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      spriteSizeIndex === index
                        ? "bg-[var(--brand-sand)] text-[var(--ink-900)]"
                        : "border border-white/20 text-[var(--ink-200)]"
                    }`}
                  >
                    {size}x{size}
                  </button>
                ))}
              </div>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Frame count</span>
            <div className="rounded-xl border border-white/20 bg-black/20 p-3">
              <input
                type="range"
                min={0}
                max={Math.max(availableFrameTiers.length - 1, 0)}
                step={1}
                value={Math.max(
                  0,
                  availableFrameTiers.findIndex((tier) => tier.value === frameCount)
                )}
                onChange={(event) => {
                  const idx = Number(event.target.value);
                  const tier = availableFrameTiers[idx];
                  if (tier) setFrameCount(tier.value);
                }}
                disabled={availableFrameTiers.length === 0}
                className="w-full accent-[var(--brand-coral)] disabled:opacity-40"
              />
              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {frameCountTiers.map((tier) => {
                  const disabled = tier.value > layoutCapacity;
                  const selected = tier.value === frameCount;
                  return (
                    <button
                      key={tier.value}
                      type="button"
                      onClick={() => {
                        if (!disabled) setFrameCount(tier.value);
                      }}
                      disabled={disabled}
                      className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                        selected
                          ? "bg-[var(--brand-coral)] text-[var(--ink-900)]"
                          : "border border-white/20 text-[var(--ink-200)]"
                      } disabled:cursor-not-allowed disabled:opacity-35`}
                    >
                      {tier.value}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--ink-300)]">
                {selectedFrameTier.value}: {selectedFrameTier.label} ({selectedFrameTier.detail})
              </p>
            </div>
          </label>

          <div className="block">
            <span className="mb-2 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Animation type</span>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/20 bg-black/20 p-3">
              {animationOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAnimationType(option.value)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    animationType === option.value
                      ? "bg-[var(--brand-sand)] text-[var(--ink-900)]"
                      : "border border-white/20 text-[var(--ink-200)]"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Projection</span>
            <select
              value={projection}
              onChange={(event) => setProjection(event.target.value as Projection)}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2"
            >
              <option value="2D">2D</option>
              <option value="isometric">Isometric</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Model</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2"
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-2 rounded-lg border border-white/20 bg-black/20 p-3 text-xs text-[var(--ink-300)]">
              <p>
                Estimated input tokens:{" "}
                <span className="font-mono text-[var(--ink-100)]">{estimatedPromptTokens}</span>
              </p>
              <p>
                Estimated output tokens:{" "}
                <span className="font-mono text-[var(--ink-100)]">
                  {estimatedOutputTokensPerAttempt * attemptsForEstimate}
                </span>
              </p>
              <p>
                Estimated attempts:{" "}
                <span className="font-mono text-[var(--ink-100)]">{attemptsForEstimate}</span>
              </p>
              <p>
                Estimated total tokens:{" "}
                <span className="font-mono text-[var(--ink-100)]">
                  {estimatedPromptTokens * attemptsForEstimate + estimatedOutputTokensPerAttempt * attemptsForEstimate}
                </span>
              </p>
              <p>
                Rate:{" "}
                <span className="font-mono text-[var(--ink-100)]">
                  ${selectedModelRate ? selectedModelRate.inputPerMTokens.toFixed(2) : "?"}/1M in, $
                  {selectedModelRate ? selectedModelRate.outputPerMTokens.toFixed(2) : "?"}/1M out
                </span>
              </p>
              <p>
                Estimated cost (worst-case):{" "}
                <span className="font-mono text-[var(--ink-100)]">
                  {estimatedCostUsd === null ? "—" : `$${estimatedCostUsd.toFixed(4)}`}
                </span>
              </p>
            </div>
          </label>

          <div className="block sm:col-span-2">
            <span className="mb-2 block text-xs uppercase tracking-wider text-[var(--ink-300)]">
              Art style profile ({styleIntensity})
            </span>
            <div className="grid gap-2 sm:grid-cols-5">
              {styleProfiles.map((style, index) => (
                <button
                  key={style.label}
                  type="button"
                  onClick={() => setStyleIndex(index)}
                  className={`rounded-xl border p-3 text-left ${
                    styleIndex === index
                      ? "border-[var(--brand-coral)] bg-[var(--brand-coral)]/15"
                      : "border-white/20 bg-black/20"
                  }`}
                >
                  <p className="text-sm font-semibold text-[var(--ink-100)]">{style.label}</p>
                  <p className="mt-1 text-xs text-[var(--ink-300)]">{style.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="block sm:col-span-2">
            <span className="mb-2 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Layout</span>
            <div className="grid gap-3 rounded-xl border border-white/20 bg-black/20 p-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-300)]">1xN rows</p>
                <div className="grid grid-cols-4 gap-2">
                  {layoutPresets
                    .filter((preset) => preset.category === "row")
                    .map((preset) => {
                      const disabled = preset.columns * preset.rows < 4;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            if (!disabled) setLayoutPresetId(preset.id);
                          }}
                          disabled={disabled}
                          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                            layoutPresetId === preset.id
                              ? "bg-[var(--brand-sand)] text-[var(--ink-900)]"
                              : "border border-white/20 text-[var(--ink-200)]"
                          } disabled:cursor-not-allowed disabled:opacity-35`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-300)]">
                  Square grids
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {layoutPresets
                    .filter((preset) => preset.category === "square")
                    .map((preset) => {
                      const disabled = preset.columns * preset.rows < 4;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            if (!disabled) setLayoutPresetId(preset.id);
                          }}
                          disabled={disabled}
                          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                            layoutPresetId === preset.id
                              ? "bg-[var(--brand-sand)] text-[var(--ink-900)]"
                              : "border border-white/20 text-[var(--ink-200)]"
                          } disabled:cursor-not-allowed disabled:opacity-35`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-300)]">
              Selected layout: {selectedLayout.label} (capacity {layoutCapacity} frames)
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Seed (optional)</span>
            <input
              type="number"
              min={0}
              value={seed}
              onChange={(event) => setSeed(event.target.value === "" ? "" : Number(event.target.value))}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Custom theme prompt</span>
            <textarea
              required
              minLength={4}
              maxLength={500}
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2"
            />
          </label>

          {error ? <p className="text-sm text-[var(--brand-coral)] sm:col-span-2">{error}</p> : null}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[var(--brand-sand)] px-6 py-3 text-sm font-bold uppercase tracking-wide text-[var(--ink-900)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Generating..." : "Generate Sprite Sheet"}
            </button>
          </div>
        </form>
      </section>

      {showLoadingScreen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--ink-900)]/95 px-6">
          <div className="w-full max-w-xl rounded-3xl border border-white/20 bg-black/40 p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-300)]">Generating</p>
            <h2 className="mt-2 font-display text-4xl text-[var(--ink-100)]">Building Sprite Sheet</h2>
            <p className="mt-2 text-sm text-[var(--ink-200)]">{progressStage.label}</p>

            <div className="mt-8 grid place-items-center">{progressStage.animation}</div>

            <div className="mt-8 h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[var(--brand-sand)] transition-all duration-300"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
            <p className="mt-3 text-right font-mono text-sm text-[var(--ink-100)]">{Math.min(progress, 100)}%</p>
          </div>
        </div>
      ) : null}
    </>
  );
};
