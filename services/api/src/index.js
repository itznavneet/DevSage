"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("./db");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const repository_routes_1 = __importDefault(require("./routes/repository.routes"));
const ai_routes_1 = __importDefault(require("./routes/ai.routes"));
const conversation_routes_1 = __importDefault(require("./routes/conversation.routes"));
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 4000;
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
app.use("/api/auth", auth_routes_1.default);
app.use("/api/repositories", repository_routes_1.default);
app.use("/api/ai", ai_routes_1.default);
app.use("/api", conversation_routes_1.default);
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "devsage-api",
    });
});
app.get("/health/db", async (_req, res) => {
    try {
        await db_1.prisma.$queryRaw `SELECT 1`;
        res.json({
            status: "ok",
            database: "connected",
        });
    }
    catch (error) {
        console.error("Database health check failed:", error);
        res.status(500).json({
            status: "error",
            database: "disconnected",
        });
    }
});
app.use((_error, _req, res, _next) => {
    res.status(500).json({ error: "Internal server error" });
});
console.log("Starting DevSage API...");
app.listen(PORT, "0.0.0.0", () => {
    console.log(`DevSage API running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map