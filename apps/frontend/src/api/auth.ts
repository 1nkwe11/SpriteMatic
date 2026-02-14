import { apiClient } from "./http";
import type { User } from "../types/models";

type UserResponse = {
  user: User;
};

export const authApi = {
  getCsrfToken: async () => {
    const { data } = await apiClient.get<{ csrfToken: string }>("/auth/csrf-token");
    return data.csrfToken;
  },
  register: async (payload: { email: string; password: string }) => {
    const { data } = await apiClient.post<UserResponse>("/auth/register", payload);
    return data.user;
  },
  login: async (payload: { email: string; password: string }) => {
    const { data } = await apiClient.post<UserResponse>("/auth/login", payload);
    return data.user;
  },
  logout: async () => {
    await apiClient.post("/auth/logout");
  },
  me: async () => {
    const { data } = await apiClient.get<UserResponse>("/auth/me");
    return data.user;
  },
  refresh: async () => {
    const { data } = await apiClient.post<UserResponse>("/auth/refresh");
    return data.user;
  }
};
