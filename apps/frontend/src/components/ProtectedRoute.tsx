import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

export const ProtectedRoute = () => {
  const status = useAuthStore((state) => state.status);
  const initialized = useAuthStore((state) => state.initialized);
  const location = useLocation();

  if (!initialized || status === "loading" || status === "idle") {
    return (
      <div className="grid min-h-[50vh] place-items-center text-[var(--ink-100)]">
        <p className="rounded-full border border-white/20 px-6 py-3">Verifying session...</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
};
