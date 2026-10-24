
import { Router } from "express";
import {
  createRepository,
  listRepositories,
  reindexRepository,
} from "../controllers/repository.controller";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.use(requireAuth);

router.post("/", createRepository);
router.get("/", listRepositories);
router.post("/:repositoryId/reindex", reindexRepository);

export default router;
