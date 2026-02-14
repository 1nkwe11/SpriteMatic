import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-[var(--brand-sand)] text-[var(--ink-900)]" : "text-[var(--ink-200)] hover:bg-white/10"
  }`;

export const AppShell = () => {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[var(--ink-900)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="font-display text-lg tracking-wider text-[var(--brand-sand)]">SPRITEMATIC</p>
            <p className="text-xs text-[var(--ink-200)]">AI Sprite & Sprite Sheet Generator</p>
          </div>

          <nav className="flex items-center gap-2">
            <NavLink to="/dashboard" className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/generator" className={navClass}>
              Generator
            </NavLink>
          </nav>

          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-[var(--ink-200)] sm:block">{user?.email}</p>
            <button
              type="button"
              className="rounded-full bg-[var(--brand-coral)] px-4 py-2 text-sm font-semibold text-[var(--ink-900)] transition hover:brightness-110"
              onClick={async () => {
                await logout();
                navigate("/auth");
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
};
