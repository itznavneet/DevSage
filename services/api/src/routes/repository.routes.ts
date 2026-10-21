
import { Router } from "express";
import {
  createRepository,
  listRepositories,
} from "../controllers/repository.controller";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.use(requireAuth);

router.post("/", createRepository);
router.get("/", listRepositories);

export default router;
