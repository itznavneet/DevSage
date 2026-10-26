"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const conversation_controller_1 = require("../controllers/conversation.controller");
const require_auth_1 = require("../middleware/require-auth");
const router = (0, express_1.Router)();
router.use(require_auth_1.requireAuth);
router.post("/repositories/:repositoryId/conversations", conversation_controller_1.createConversation);
router.get("/repositories/:repositoryId/conversations", conversation_controller_1.listConversations);
router.get("/conversations/:conversationId", conversation_controller_1.getConversation);
router.delete("/conversations/:conversationId", conversation_controller_1.deleteConversation);
router.post("/conversations/:conversationId/messages", conversation_controller_1.createMessage);
exports.default = router;
//# sourceMappingURL=conversation.routes.js.map