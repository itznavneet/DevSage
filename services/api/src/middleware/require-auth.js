"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.devsage_session;
        if (!token || !/^[a-f0-9]{64}$/.test(token)) {
            return res.status(401).json({ message: "Authentication required" });
        }
        const tokenHash = (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
        const session = await db_1.prisma.session.findUnique({
            where: { tokenHash },
            include: { user: true },
        });
        if (!session || session.expiresAt <= new Date()) {
            if (session) {
                await db_1.prisma.session.delete({ where: { id: session.id } });
            }
            return res.status(401).json({ message: "Session expired" });
        }
        res.locals.user = {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
        };
        next();
    }
    catch (error) {
        next(error);
    }
}
//# sourceMappingURL=require-auth.js.map