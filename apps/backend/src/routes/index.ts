import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { generateRouter } from "./generate.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/generate", generateRouter);
