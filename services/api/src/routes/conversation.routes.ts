import { Router } from "express";
import {
  createConversation,
  createMessage,
  deleteConversation,
  getConversation,
  listConversations,
} from "../controllers/conversation.controller";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.use(requireAuth);

router.post("/repositories/:repositoryId/conversations", createConversation);
router.get("/repositories/:repositoryId/conversations", listConversations);
router.get("/conversations/:conversationId", getConversation);
router.delete("/conversations/:conversationId", deleteConversation);
router.post("/conversations/:conversationId/messages", createMessage);

export default router;
