
import { Router } from "express";
import { askRepository, searchRepository } from "../controllers/ai.controller";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.use(requireAuth);

router.post("/repositories/:repositoryId/ask", askRepository);
router.post("/repositories/:repositoryId/search", searchRepository);

export default router;
