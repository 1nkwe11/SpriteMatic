import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../observability/logger.js";
import { ApiError } from "../utils/errors.js";

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  next(new ApiError(404, "Route not found"));
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  void _next;
  const requestId = res.getHeader("x-request-id");
  const requestMeta = {
    requestId: typeof requestId === "string" ? requestId : null,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  };

  if (err instanceof ZodError) {
    logger.warn("request_validation_error", {
      ...requestMeta,
      issues: err.issues
    });
    return res.status(400).json({
      message: "Validation failed",
      errors: err.flatten()
    });
  }

  if (err instanceof ApiError) {
    const logFn = err.statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    logFn("request_api_error", {
      ...requestMeta,
      statusCode: err.statusCode,
      message: err.message,
      details: err.details
    });
    return res.status(err.statusCode).json({
      message: err.message,
      details: err.details
    });
  }

  const message = err instanceof Error ? err.message : "Unexpected error";
  if (/invalid csrf token/i.test(message)) {
    logger.warn("request_csrf_error", {
      ...requestMeta,
      message
    });
    return res.status(403).json({
      message: "Invalid CSRF token"
    });
  }

  logger.error("request_unhandled_error", {
    ...requestMeta,
    message,
    error: err
  });

  return res.status(500).json({
    message
  });
};
