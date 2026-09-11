import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@prisma/client";
import { forbidden, unauthorized } from "../../common/errors.js";
import { verifyAccessToken } from "./tokens.js";
import { prisma } from "../../common/prisma.js";

export interface AuthContext {
  userId: string;
  roles: Role[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("Missing bearer token");
  const token = header.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    // Ensure user still exists (cheap, indexed).
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, roles: true },
    });
    if (!user) throw unauthorized("Invalid token");
    req.auth = { userId: user.id, roles: user.roles };
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    throw unauthorized("Invalid or expired token");
  }
}

export function requireRole(...anyOf: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.auth) throw unauthorized();
    const ok = req.auth.roles.some((r) => anyOf.includes(r));
    if (!ok) throw forbidden("Insufficient role");
  };
}

export const hasRole = (roles: Role[], ...anyOf: Role[]): boolean =>
  roles.some((r) => anyOf.includes(r));
