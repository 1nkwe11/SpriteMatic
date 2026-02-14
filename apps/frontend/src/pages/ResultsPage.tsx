import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGenerationStore } from "../stores/generation-store";
import { formatModelLabelWithCost } from "../constants/modelRates";

const downloadJson = (filename: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const ResultsPage = () => {
  const { generationId = "" } = useParams();
  const navigate = useNavigate();
  const current = useGenerationStore((state) => state.current);
  const loadGeneration = useGenerationStore((state) => state.loadGeneration);
  const pollUntilSettled = useGenerationStore((state) => state.pollUntilSettled);
  const regenerate = useGenerationStore((state) => state.regenerate);
  const deleteGeneration = useGenerationStore((state) => state.deleteGeneration);
  const setCurrent = useGenerationStore((state) => state.setCurrent);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!generationId) return;
    setError(null);
    setCurrent(null);

    const run = async () => {
      try {
        const generation = await loadGeneration(generationId);
        if (generation.status === "pending" || generation.status === "processing") {
          await pollUntilSettled(generation.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load generation");
      }
    };

    void run();
  }, [generationId, loadGeneration, pollUntilSettled, setCurrent]);

  const currentForRoute = current?.id === generationId ? current : null;

  const statusMessage = useMemo(() => {
    if (!currentForRoute) return "Loading...";
    if (currentForRoute.status === "pending" || currentForRoute.status === "processing") return "Generation in progress...";
    if (currentForRoute.status === "failed") return currentForRoute.errorReason ?? "Generation failed";
    return "Generation complete";
  }, [currentForRoute]);

  const quality = currentForRoute?.qualityDiagnostics ?? currentForRoute?.jsonConfig?.quality;
  const estimatedOutputTokens = currentForRoute?.estimatedOutputTokens ?? 0;
  const estimatedTotalTokens =
    currentForRoute?.totalTokens ??
    ((currentForRoute?.promptTokens ?? 0) + (currentForRoute?.outputTokens ?? estimatedOutputTokens));
  const outputTokenDisplay = currentForRoute?.outputTokens ?? estimatedOutputTokens;
  const modelWithCost = currentForRoute?.modelVersion
    ? formatModelLabelWithCost(currentForRoute.modelVersion)
    : "Pending";
  return (
    <section className="space-y-5 rounded-3xl border border-white/15 bg-black/20 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-[var(--ink-100)]">Generation Results</h1>
          <p className="mt-2 text-sm text-[var(--ink-200)]">{statusMessage}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="rounded-full border border-white/25 px-4 py-2 text-sm text-[var(--ink-100)]"
        >
          Back to Dashboard
        </button>
      </div>

      {error ? <p className="text-sm text-[var(--brand-coral)]">{error}</p> : null}

      {currentForRoute ? (
        <>
          <div className="grid gap-4 rounded-2xl border border-white/10 bg-[var(--ink-900)]/40 p-4 sm:grid-cols-2">
            <p className="text-sm text-[var(--ink-100)]">
              {currentForRoute.frameCount} frames • {currentForRoute.spriteSize}px • {currentForRoute.columns}x{currentForRoute.rows}
            </p>
            <p className="text-sm text-[var(--ink-100)]">
              Projection: {currentForRoute.projection} • Animation: {currentForRoute.animationType}
            </p>
            <p className="text-xs text-[var(--ink-300)]">Seed: {currentForRoute.seed ?? "auto"}</p>
            <p className="text-xs text-[var(--ink-300)]">
              Model: {modelWithCost}
            </p>
            <p className="text-xs text-[var(--ink-300)]">
              Input tokens: {currentForRoute.promptTokens?.toLocaleString() ?? "0"}
            </p>
            <p className="text-xs text-[var(--ink-300)]">
              Output tokens: {outputTokenDisplay.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--ink-300)]">
              Total tokens: {estimatedTotalTokens.toLocaleString()}
            </p>
            {currentForRoute.estimatedCostUsd !== undefined && currentForRoute.estimatedCostUsd !== null ? (
              <p className="text-xs text-[var(--ink-300)]">
                Estimated cost: ${currentForRoute.estimatedCostUsd.toFixed(4)}
              </p>
            ) : null}
          </div>

          {currentForRoute.imageUrl ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-4">
              <img
                src={currentForRoute.imageUrl}
                alt="Generated sprite sheet"
                className="max-h-[560px] w-full object-contain [image-rendering:pixelated]"
              />
            </div>
          ) : null}

          {currentForRoute.qualityWarnings.length > 0 ? (
            <div className="rounded-2xl border border-[var(--brand-coral)]/60 bg-[var(--brand-coral)]/10 p-4">
              <p className="text-sm font-semibold text-[var(--brand-coral)]">Quality warnings</p>
              <ul className="mt-2 list-disc pl-5 text-xs text-[var(--ink-200)]">
                {currentForRoute.qualityWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {quality ? (
            <div className="rounded-2xl border border-white/20 bg-black/30 p-4">
              <p className="text-sm font-semibold text-[var(--ink-100)]">
                Quality score: {quality.score.toFixed(1)} / 100
              </p>
              <div className="mt-2 grid gap-2 text-xs text-[var(--ink-300)] sm:grid-cols-2">
                <p>Transparent pixels: {(quality.metrics.transparentPixelRatio * 100).toFixed(1)}%</p>
                <p>Semi-transparent pixels: {(quality.metrics.translucentPixelRatio * 100).toFixed(1)}%</p>
                <p>Anchor drift: {quality.metrics.maxAnchorDriftPx.toFixed(2)}px</p>
                <p>Distinct frame pairs: {(quality.metrics.distinctPairRatio * 100).toFixed(1)}%</p>
                <p>Boundary bleed: {(quality.metrics.maxBoundaryBleedRatio * 100).toFixed(1)}%</p>
                <p>Quantized colors: {quality.metrics.quantizedColorCount}</p>
              </div>
            </div>
          ) : null}

          {currentForRoute.settingsVerification ? (
            <div
              className={`rounded-2xl border p-4 ${
                currentForRoute.settingsVerification.passed
                  ? "border-emerald-400/60 bg-emerald-500/10"
                  : "border-[var(--brand-coral)]/60 bg-[var(--brand-coral)]/10"
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  currentForRoute.settingsVerification.passed ? "text-emerald-300" : "text-[var(--brand-coral)]"
                }`}
              >
                {currentForRoute.settingsVerification.passed
                  ? "Settings verification passed"
                  : "Settings verification failed"}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-200)]">{currentForRoute.settingsVerification.summary}</p>
              {currentForRoute.settingsVerification.failures.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-[var(--ink-200)]">
                  {currentForRoute.settingsVerification.failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {currentForRoute.imageUrl ? (
              <a
                href={currentForRoute.imageUrl}
                download={`sprite-${currentForRoute.id}.png`}
                className="rounded-full bg-[var(--brand-sand)] px-5 py-2 text-sm font-semibold text-[var(--ink-900)]"
              >
                Download PNG
              </a>
            ) : null}
            {currentForRoute.jsonConfig ? (
              <button
                type="button"
                onClick={() => downloadJson(`sprite-${currentForRoute.id}.json`, currentForRoute.jsonConfig)}
                className="rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-[var(--ink-100)]"
              >
                Download JSON
              </button>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                const result = await regenerate(currentForRoute.id);
                navigate(`/results/${result.generationId}`);
              }}
              className="rounded-full bg-[var(--brand-coral)] px-5 py-2 text-sm font-semibold text-[var(--ink-900)]"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={async () => {
                await deleteGeneration(currentForRoute.id);
                navigate("/dashboard");
              }}
              className="rounded-full border border-[var(--brand-coral)] px-5 py-2 text-sm font-semibold text-[var(--brand-coral)]"
            >
              Delete
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};
