import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

type Schema = ZodType<unknown>;

export const validateBody = (schema: Schema) => (req: Request, _res: Response, next: NextFunction) => {
  req.body = schema.parse(req.body);
  next();
};
