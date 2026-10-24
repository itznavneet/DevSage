"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ai_controller_1 = require("../controllers/ai.controller");
const require_auth_1 = require("../middleware/require-auth");
const router = (0, express_1.Router)();
router.use(require_auth_1.requireAuth);
router.post("/repositories/:repositoryId/ask", ai_controller_1.askRepository);
router.post("/repositories/:repositoryId/search", ai_controller_1.searchRepository);
exports.default = router;
//# sourceMappingURL=ai.routes.js.map