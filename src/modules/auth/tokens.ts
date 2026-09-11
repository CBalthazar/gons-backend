import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export interface AccessPayload {
  sub: string;
  roles: Role[];
}

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET ?? "");

export async function signAccessToken(userId: string, roles: Role[], ttlSec: number): Promise<string> {
  return new SignJWT({ roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .setIssuer("gons-api")
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, secret(), { issuer: "gons-api" });
  return {
    sub: payload.sub as string,
    roles: (payload.roles as Role[]) ?? [],
  };
}

/** Opaque refresh token (never a JWT): returned to cookie, SHA-256 stored in DB. */
export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export const hashToken = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");
