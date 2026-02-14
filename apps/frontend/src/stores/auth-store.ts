import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authApi } from "../api/auth";
import { configureHttpAuthHandlers } from "../api/http";
import type { User } from "../types/models";

type AuthStatus = "idle" | "loading" | "authenticated" | "anonymous";

type AuthState = {
  user: User | null;
  csrfToken: string | null;
  status: AuthStatus;
  initialized: boolean;
  boot: () => Promise<void>;
  login: (payload: { email: string; password: string }) => Promise<void>;
  register: (payload: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  forceAnonymous: () => void;
  refreshSession: () => Promise<void>;
  refreshCsrfToken: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      csrfToken: null,
      status: "idle",
      initialized: false,
      boot: async () => {
        if (get().initialized) return;

        set({ status: "loading" });
        try {
          const csrfToken = await authApi.getCsrfToken();
          set({ csrfToken });
        } catch {
          set({ csrfToken: null });
        }

        try {
          const user = await authApi.me();
          set({ user, status: "authenticated", initialized: true });
          return;
        } catch {
          set({ user: null, status: "anonymous", initialized: true });
        }
      },
      login: async ({ email, password }) => {
        if (!get().csrfToken) {
          const csrfToken = await authApi.getCsrfToken();
          set({ csrfToken });
        }
        const user = await authApi.login({ email, password });
        set({ user, status: "authenticated", initialized: true });
      },
      register: async ({ email, password }) => {
        if (!get().csrfToken) {
          const csrfToken = await authApi.getCsrfToken();
          set({ csrfToken });
        }
        const user = await authApi.register({ email, password });
        set({ user, status: "authenticated", initialized: true });
      },
      logout: async () => {
        try {
          if (!get().csrfToken) {
            const csrfToken = await authApi.getCsrfToken();
            set({ csrfToken });
          }
          await authApi.logout();
        } finally {
          set({ user: null, status: "anonymous" });
        }
      },
      forceAnonymous: () => {
        set({ user: null, status: "anonymous" });
      },
      refreshSession: async () => {
        const user = await authApi.refresh();
        set({ user, status: "authenticated", initialized: true });
      },
      refreshCsrfToken: async () => {
        const csrfToken = await authApi.getCsrfToken();
        set({ csrfToken });
      }
    }),
    {
      name: "spritematic-auth",
      partialize: (state) => ({
        user: state.user,
        status: state.status
      })
    }
  )
);

configureHttpAuthHandlers({
  getCsrfToken: () => useAuthStore.getState().csrfToken,
  onUnauthorized: async () => {
    useAuthStore.getState().forceAnonymous();
  },
  onRefreshSession: async () => {
    await useAuthStore.getState().refreshSession();
  },
  onRefreshCsrfToken: async () => {
    await useAuthStore.getState().refreshCsrfToken();
  }
});
