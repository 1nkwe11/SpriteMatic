import { doubleCsrf } from "csrf-csrf";
import { isProd, env } from "../config/env.js";

const csrfUtilities = doubleCsrf({
  getSecret: () => env.CSRF_SECRET,
  getSessionIdentifier: (req) => `${req.ip}:${req.headers["user-agent"] ?? "unknown"}`,
  cookieName: "sm_csrf_token",
  cookieOptions: {
    secure: isProd,
    sameSite: "lax",
    path: "/",
    httpOnly: true
  },
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"] as string
});

export const csrfProtection = csrfUtilities.doubleCsrfProtection;
export const generateCsrfToken = csrfUtilities.generateCsrfToken;
