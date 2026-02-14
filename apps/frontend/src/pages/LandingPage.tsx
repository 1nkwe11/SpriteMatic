import { Link } from "react-router-dom";

export const LandingPage = () => (
  <div className="relative overflow-hidden">
    <div className="pointer-events-none absolute -left-20 top-16 h-72 w-72 rounded-full bg-[var(--brand-coral)]/30 blur-3xl" />
    <div className="pointer-events-none absolute -right-16 bottom-8 h-96 w-96 rounded-full bg-[var(--brand-sand)]/20 blur-3xl" />

    <section className="mx-auto flex min-h-screen max-w-5xl flex-col items-start justify-center px-6 py-20">
      <p className="mb-4 rounded-full border border-[var(--brand-sand)]/50 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-sand)]">
        Production-ready sprites
      </p>
      <h1 className="max-w-3xl font-display text-5xl leading-tight text-[var(--ink-100)] sm:text-7xl">
        Build game-ready sprite sheets with repeatable AI generation.
      </h1>
      <p className="mt-6 max-w-2xl text-base text-[var(--ink-200)] sm:text-lg">
        SpriteMatic generates transparent pixel-art sheets, validates frame integrity, and exports JSON animation
        configs for Unity, Godot, and Phaser pipelines.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Link
          to="/auth"
          className="rounded-full bg-[var(--brand-sand)] px-7 py-3 text-sm font-bold uppercase tracking-wide text-[var(--ink-900)] transition hover:brightness-105"
        >
          Sign In / Register
        </Link>
        <Link
          to="/dashboard"
          className="rounded-full border border-white/30 px-7 py-3 text-sm font-bold uppercase tracking-wide text-[var(--ink-100)] transition hover:bg-white/10"
        >
          Open Dashboard
        </Link>
      </div>
    </section>
  </div>
);
