
import { Router } from "express";
import { askRepository } from "../controllers/ai.controller";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.use(requireAuth);

router.post("/repositories/:repositoryId/ask", askRepository);

export default router;
