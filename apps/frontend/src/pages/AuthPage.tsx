import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

type Mode = "login" | "register";

export const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from ?? "/dashboard";
  }, [location.state]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "login") {
        await login({ email, password });
      } else {
        await register({ email, password });
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const fallback = mode === "login" ? "Login failed." : "Registration failed.";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-5 py-12">
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[var(--ink-900)]/80 p-8 shadow-2xl backdrop-blur">
        <h1 className="font-display text-3xl text-[var(--ink-100)]">{mode === "login" ? "Sign In" : "Register"}</h1>
        <p className="mt-2 text-sm text-[var(--ink-200)]">Cookie-secured JWT auth with CSRF protection enabled.</p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-full border border-white/20 p-1">
          <button
            type="button"
            className={`rounded-full px-3 py-2 text-sm font-semibold ${
              mode === "login" ? "bg-[var(--brand-sand)] text-[var(--ink-900)]" : "text-[var(--ink-100)]"
            }`}
            onClick={() => setMode("login")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-2 text-sm font-semibold ${
              mode === "register" ? "bg-[var(--brand-sand)] text-[var(--ink-900)]" : "text-[var(--ink-100)]"
            }`}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-[var(--ink-100)] outline-none ring-[var(--brand-coral)]/60 transition focus:ring"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-[var(--ink-300)]">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-[var(--ink-100)] outline-none ring-[var(--brand-coral)]/60 transition focus:ring"
            />
          </label>

          {mode === "register" ? (
            <p className="text-xs text-[var(--ink-300)]">
              Must include upper/lowercase, number, special character, and be at least 10 characters.
            </p>
          ) : null}

          {error ? <p className="text-sm text-[var(--brand-coral)]">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-[var(--brand-coral)] px-4 py-3 text-sm font-bold uppercase tracking-wide text-[var(--ink-900)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Submitting..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
};
