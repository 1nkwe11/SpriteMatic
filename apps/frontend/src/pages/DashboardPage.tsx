import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { useGenerationStore } from "../stores/generation-store";

export const DashboardPage = () => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const history = useGenerationStore((state) => state.history);
  const fetchHistory = useGenerationStore((state) => state.fetchHistory);
  const deleteGeneration = useGenerationStore((state) => state.deleteGeneration);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/15 bg-black/20 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--ink-300)]">Dashboard</p>
        <h1 className="mt-2 font-display text-4xl text-[var(--ink-100)]">Welcome back, {user?.email}</h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--ink-200)]">
          Generate new animations, review quality warnings, and export PNG + JSON assets from one place.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/generator"
            className="rounded-full bg-[var(--brand-sand)] px-5 py-2 text-sm font-semibold text-[var(--ink-900)] transition hover:brightness-105"
          >
            New Sprite Generation
          </Link>
          <button
            type="button"
            onClick={() => void fetchHistory()}
            className="rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-[var(--ink-100)] transition hover:bg-white/10"
          >
            Refresh History
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-white/15 bg-black/20 p-6">
        <h2 className="font-display text-2xl text-[var(--ink-100)]">Generation History</h2>
        <div className="mt-5 space-y-3">
          {history.length === 0 ? <p className="text-sm text-[var(--ink-300)]">No generations yet.</p> : null}

          {history.map((item) => (
            <article
              key={item.id}
              className="grid gap-3 rounded-2xl border border-white/15 bg-[var(--ink-900)]/40 p-4 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--ink-300)]">{item.animationType}</p>
                <p className="font-mono text-xs text-[var(--ink-300)]">{item.id}</p>
                <p className="mt-1 text-sm text-[var(--ink-100)]">
                  {item.frameCount} frames • {item.spriteSize}px • {item.columns}x{item.rows}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-300)]">
                  {new Date(item.createdAt).toLocaleString()} • status: {item.status}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => navigate(`/results/${item.id}`)}
                  className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-[var(--ink-100)]"
                >
                  View
                </button>
                {item.imageUrl ? (
                  <a
                    href={item.imageUrl}
                    download={`sprite-${item.id}.png`}
                    className="rounded-full bg-[var(--brand-sand)] px-3 py-1 text-xs font-semibold text-[var(--ink-900)]"
                  >
                    Download PNG
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void deleteGeneration(item.id)}
                  className="rounded-full bg-[var(--brand-coral)]/85 px-3 py-1 text-xs font-semibold text-[var(--ink-900)]"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
