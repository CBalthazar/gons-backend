import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyReply } from "fastify";
import type { Role } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { conflict, notFound, unauthorized } from "../../common/errors.js";
import { hashToken, newRefreshToken, signAccessToken } from "./tokens.js";
import type { Env } from "../../env.js";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  roles: Role[];
  avatarUrl?: string | null;
  createdAt: string;
}

export const toPublicUser = (u: {
  id: string; email: string; username: string; roles: Role[]; avatarUrl?: string | null; createdAt: Date;
}): PublicUser => ({
  // Explicit pick: never spread the full row (it carries passwordHash).
  id: u.id,
  email: u.email,
  username: u.username,
  roles: u.roles,
  avatarUrl: u.avatarUrl ?? undefined,
  createdAt: u.createdAt.toISOString(),
});

export function setRefreshCookie(reply: FastifyReply, env: Env, raw: string, expires: Date): void {
  reply.setCookie(env.REFRESH_COOKIE_NAME, raw, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: `${env.API_PREFIX}/auth`,
    expires,
    maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
  });
}

export function clearRefreshCookie(reply: FastifyReply, env: Env): void {
  reply.clearCookie(env.REFRESH_COOKIE_NAME, { path: `${env.API_PREFIX}/auth` });
}

async function issueSession(env: Env, userId: string, roles: Role[]) {
  const accessToken = await signAccessToken(userId, roles, env.ACCESS_TOKEN_TTL);
  const { raw, hash } = newRefreshToken();
  const family = randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({ data: { userId, tokenHash: hash, family, expiresAt } });
  return { accessToken, refreshRaw: raw, refreshExpires: expiresAt };
}

export async function registerUser(env: Env, input: { email: string; username: string; password: string }) {
  const email = input.email.toLowerCase().trim();
  const username = input.username.trim();
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: { equals: username, mode: "insensitive" } }] },
    select: { email: true, username: true },
  });
  if (existing) {
    if (existing.email === email) throw conflict("Email already taken");
    throw conflict("Username already taken");
  }
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.user.create({
    data: { email, username, passwordHash, roles: ["buyer"] },
  });
  const session = await issueSession(env, user.id, user.roles);
  return { user: toPublicUser(user), ...session };
}

export async function loginUser(env: Env, identifier: string, password: string) {
  const id = identifier.trim();
  const isEmail = id.includes("@");
  const user = await prisma.user.findFirst({
    where: isEmail ? { email: id.toLowerCase() } : { username: { equals: id, mode: "insensitive" } },
  });
  if (!user) throw unauthorized("Invalid credentials");
  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw unauthorized("Invalid credentials");
  const session = await issueSession(env, user.id, user.roles);
  return { user: toPublicUser(user), ...session };
}

export async function rotateRefresh(env: Env, raw: string) {
  const hash = hashToken(raw);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });
  // Reuse detection: presented token already revoked -> revoke whole family.
  if (!stored) {
    return null;
  }
  if (stored.revokedAt || stored.expiresAt < new Date()) {
    await prisma.refreshToken.updateMany({
      where: { family: stored.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const { raw: nextRaw, hash: nextHash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({
    data: { userId: stored.userId, tokenHash: nextHash, family: stored.family, expiresAt },
  });
  const accessToken = await signAccessToken(stored.userId, stored.user.roles, env.ACCESS_TOKEN_TTL);
  return { user: toPublicUser(stored.user), accessToken, refreshRaw: nextRaw, refreshExpires: expiresAt };
}

export async function revokeRefresh(raw: string | undefined): Promise<void> {
  if (!raw) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  return toPublicUser(user);
}
