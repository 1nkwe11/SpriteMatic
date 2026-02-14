import type { Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { UserRole } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { accessCookieOptions, ACCESS_COOKIE, clearCookieOptions, REFRESH_COOKIE, refreshCookieOptions } from "../lib/cookies.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { ApiError } from "../utils/errors.js";

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const toPublicUser = (user: { id: string; email: string; role: UserRole; createdAt: Date }) => ({
  id: user.id,
  email: user.email,
  role: user.role === "ADMIN" ? "admin" : "user",
  createdAt: user.createdAt
});

export const registerUser = async (email: string, password: string) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ApiError(409, "Email already in use");
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  return prisma.user.create({
    data: {
      email,
      passwordHash,
      dailyGenerationLimit: env.DAILY_DEFAULT_LIMIT
    }
  });
};

export const verifyUserCredentials = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    throw new ApiError(401, "Invalid credentials");
  }

  return user;
};

export const issueSessionCookies = async (
  res: Response,
  user: { id: string; role: UserRole },
  existingRefreshToken?: string
) => {
  if (existingRefreshToken) {
    await revokeRefreshToken(existingRefreshToken);
  }

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role
  });

  const refreshToken = signRefreshToken({
    sub: user.id
  });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
    }
  });

  res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
};

export const revokeRefreshToken = async (refreshToken: string) => {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
};

export const refreshSession = async (res: Response, refreshToken: string) => {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid refresh token");
  }

  const tokenHash = hashToken(refreshToken);
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, "Refresh token expired");
  }

  if (tokenRecord.userId !== payload.sub) {
    throw new ApiError(401, "Token subject mismatch");
  }

  await issueSessionCookies(res, { id: tokenRecord.user.id, role: tokenRecord.user.role }, refreshToken);
  return tokenRecord.user;
};

export const clearSessionCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, clearCookieOptions);
  res.clearCookie(REFRESH_COOKIE, clearCookieOptions);
};
