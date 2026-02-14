import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

type AuthHandlers = {
  getCsrfToken: () => string | null;
  onUnauthorized: () => void | Promise<void>;
  onRefreshSession: () => Promise<void>;
  onRefreshCsrfToken: () => Promise<void>;
};

let handlers: AuthHandlers = {
  getCsrfToken: () => null,
  onUnauthorized: async () => undefined,
  onRefreshSession: async () => undefined,
  onRefreshCsrfToken: async () => undefined
};

type RequestConfigWithRetry = InternalAxiosRequestConfig & {
  _authRetried?: boolean;
  _csrfRetried?: boolean;
};

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api",
  withCredentials: true
});

apiClient.interceptors.request.use((config) => {
  const cfg = config;
  const method = cfg.method?.toUpperCase();
  const token = handlers.getCsrfToken();
  const shouldAttachCsrf = token && method && !["GET", "HEAD", "OPTIONS"].includes(method);

  if (shouldAttachCsrf) {
    cfg.headers.set("x-csrf-token", token);
  }

  return cfg;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const original = error.config as RequestConfigWithRetry | undefined;
    const url = original?.url ?? "";
    const responseMessage =
      typeof error.response?.data === "object" && error.response?.data && "message" in error.response.data
        ? String(error.response.data.message)
        : "";

    const isCsrfError = status === 403 && /csrf/i.test(responseMessage);
    if (isCsrfError && original && !original._csrfRetried && !url.includes("/auth/csrf-token")) {
      original._csrfRetried = true;
      await handlers.onRefreshCsrfToken();
      return apiClient.request(original);
    }

    if (status !== 401 || !original || original._authRetried || url.includes("/auth/refresh")) {
      throw error;
    }

    original._authRetried = true;
    try {
      await handlers.onRefreshSession();
      return apiClient.request(original);
    } catch {
      await handlers.onUnauthorized();
      throw error;
    }
  }
);

export const configureHttpAuthHandlers = (nextHandlers: AuthHandlers) => {
  handlers = nextHandlers;
};
