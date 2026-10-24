"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const repository_controller_1 = require("../controllers/repository.controller");
const require_auth_1 = require("../middleware/require-auth");
const router = (0, express_1.Router)();
router.use(require_auth_1.requireAuth);
router.post("/", repository_controller_1.createRepository);
router.get("/", repository_controller_1.listRepositories);
router.post("/:repositoryId/reindex", repository_controller_1.reindexRepository);
exports.default = router;
//# sourceMappingURL=repository.routes.js.map