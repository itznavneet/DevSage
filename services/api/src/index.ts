import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import {prisma} from "./db";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import repositoryRoutes from "./routes/repository.routes";
import aiRoutes from "./routes/ai.routes";
import conversationRoutes from "./routes/conversation.routes";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api", conversationRoutes);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "devsage-api",
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: "Internal server error" });
});

console.log("Starting DevSage API...");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DevSage API running on port ${PORT}`);
});
