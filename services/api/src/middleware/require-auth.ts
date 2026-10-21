import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../db";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {  const token = req.cookies?.devsage_session as string | undefined;

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
      }
      return res.status(401).json({ message: "Session expired" });
    }

    res.locals.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    };

    next();
  } catch (error) {
    next(error);
  }
}