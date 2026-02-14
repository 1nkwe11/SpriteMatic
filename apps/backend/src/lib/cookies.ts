import type { CookieOptions } from "express";
import { env, isProd } from "../config/env.js";

export const ACCESS_COOKIE = "sm_access_token";
export const REFRESH_COOKIE = "sm_refresh_token";

const sharedCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/"
};

export const accessCookieOptions: CookieOptions = {
  ...sharedCookieOptions,
  maxAge: env.JWT_ACCESS_EXPIRES_MINUTES * 60 * 1000
};

export const refreshCookieOptions: CookieOptions = {
  ...sharedCookieOptions,
  maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000
};

export const clearCookieOptions: CookieOptions = {
  ...sharedCookieOptions,
  maxAge: 0
};
