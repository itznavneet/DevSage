import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../db";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

const COOKIE_NAME = "devsage_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const { name, email, password } = parsed.data;

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    const token = randomBytes(32).toString("hex");

    await prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_DURATION),
      },
    });

    setSessionCookie(res, token);
    return res.status(201).json({ user });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ message: "Registration failed" });
  }
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parsed.data;

   try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = randomBytes(32).toString("hex");

    await prisma.session.create({
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
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ message: "Login failed" });
  }
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  clearSessionCookie(res);
  return res.json({ message: "Logged out successfully" });
}

export async function me(req: Request, res: Response) {
  return res.json({ user: res.locals.user });
}