import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../lib/cookies.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { generateCsrfToken } from "../middleware/csrf.js";
import { validateBody } from "../middleware/validate.js";
import { authRateLimit } from "../middleware/rate-limit.js";
import { ApiError } from "../utils/errors.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import {
  clearSessionCookies,
  issueSessionCookies,
  refreshSession,
  registerUser,
  revokeRefreshToken,
  toPublicUser,
  verifyUserCredentials
} from "../services/auth.service.js";

export const authRouter = Router();

authRouter.get("/csrf-token", (req, res) => {
  const csrfToken = generateCsrfToken(req, res);
  res.json({ csrfToken });
});

authRouter.post("/register", authRateLimit, validateBody(registerSchema), async (req, res) => {
  const user = await registerUser(req.body.email, req.body.password);
  await issueSessionCookies(res, { id: user.id, role: user.role });

  res.status(201).json({
    user: toPublicUser(user)
  });
});

authRouter.post("/login", authRateLimit, validateBody(loginSchema), async (req, res) => {
  const user = await verifyUserCredentials(req.body.email, req.body.password);
  await issueSessionCookies(res, { id: user.id, role: user.role });

  res.json({
    user: toPublicUser(user)
  });
});

authRouter.post("/logout", authRateLimit, async (req, res) => {
  const refreshToken = req.cookies[REFRESH_COOKIE] as string | undefined;
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  clearSessionCookies(res);
  res.json({ success: true });
});

authRouter.post("/refresh", authRateLimit, async (req, res) => {
  const refreshToken = req.cookies[REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) {
    throw new ApiError(401, "Missing refresh token");
  }

  const user = await refreshSession(res, refreshToken);
  res.json({
    user: toPublicUser(user)
  });
});

authRouter.get("/me", async (req, res) => {
  const accessToken = req.cookies[ACCESS_COOKIE] as string | undefined;
  const refreshToken = req.cookies[REFRESH_COOKIE] as string | undefined;

  if (!accessToken && !refreshToken) {
    throw new ApiError(401, "Not authenticated");
  }

  let userId: string | null = null;

  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      userId = payload.sub;
    } catch {
      userId = null;
    }
  }

  if (!userId) {
    if (!refreshToken) {
      throw new ApiError(401, "Session expired");
    }

    const refreshedUser = await refreshSession(res, refreshToken);
    return res.json({
      user: toPublicUser(refreshedUser)
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return res.json({
    user: toPublicUser(user)
  });
});
