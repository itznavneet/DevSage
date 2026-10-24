"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.logout = logout;
exports.me = me;
const node_crypto_1 = require("node:crypto");
const argon2_1 = __importDefault(require("argon2"));
const zod_1 = require("zod");
const db_1 = require("../db");
const registerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(80),
    email: zod_1.z.string().trim().email().transform((v) => v.toLowerCase()),
    password: zod_1.z.string().min(8).max(128),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email().transform((v) => v.toLowerCase()),
    password: zod_1.z.string().min(1).max(128),
});
const COOKIE_NAME = "devsage_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
function hashToken(token) {
    return (0, node_crypto_1.createHash)("sha256").update(token).digest("hex");
}
function setSessionCookie(res, token) {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DURATION,
    });
}
function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
    });
}
async function register(req, res) {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid input",
            errors: parsed.error.flatten().fieldErrors,
        });
    }
    const { name, email, password } = parsed.data;
    try {
        const existingUser = await db_1.prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            return res.status(409).json({ message: "Email already registered" });
        }
        const passwordHash = await argon2_1.default.hash(password);
        const user = await db_1.prisma.user.create({
            data: { name, email, passwordHash },
            select: { id: true, name: true, email: true },
        });
        const token = (0, node_crypto_1.randomBytes)(32).toString("hex");
        await db_1.prisma.session.create({
            data: {
                tokenHash: hashToken(token),
                userId: user.id,
                expiresAt: new Date(Date.now() + SESSION_DURATION),
            },
        });
        setSessionCookie(res, token);
        return res.status(201).json({ user });
    }
    catch (error) {
        console.error("Registration failed:", error);
        return res.status(500).json({ message: "Registration failed" });
    }
}
async function login(req, res) {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid input",
            errors: parsed.error.flatten().fieldErrors,
        });
    }
    const { email, password } = parsed.data;
    try {
        const user = await db_1.prisma.user.findUnique({ where: { email } });
        if (!user || !(await argon2_1.default.verify(user.passwordHash, password))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        const token = (0, node_crypto_1.randomBytes)(32).toString("hex");
        await db_1.prisma.session.create({
            data: {
                tokenHash: hashToken(token),
                userId: user.id,
                expiresAt: new Date(Date.now() + SESSION_DURATION),
            },
        });
        setSessionCookie(res, token);
        return res.json({
            user: { id: user.id, name: user.name, email: user.email },
        });
    }
    catch (error) {
        console.error("Login failed:", error);
        return res.status(500).json({ message: "Login failed" });
    }
}
async function logout(req, res) {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
        await db_1.prisma.session.deleteMany({
            where: { tokenHash: hashToken(token) },
        });
    }
    clearSessionCookie(res);
    return res.json({ message: "Logged out successfully" });
}
async function me(req, res) {
    return res.json({ user: res.locals.user });
}
//# sourceMappingURL=auth.controller.js.map