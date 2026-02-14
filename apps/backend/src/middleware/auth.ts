import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { ApiError } from "../utils/errors.js";

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    return next(new ApiError(401, "Authentication required"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      role: payload.role
    };
    return next();
  } catch {
    return next(new ApiError(401, "Invalid or expired access token"));
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth || !allowedRoles.includes(req.auth.role)) {
    return next(new ApiError(403, "Forbidden"));
  }
  next();
};
