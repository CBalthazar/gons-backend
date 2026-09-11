import type { FastifyInstance } from "fastify";
import type { Env } from "../../env.js";
import { forgotSchema, loginSchema, registerSchema } from "./schemas.js";
import {
  clearRefreshCookie,
  getMe,
  loginUser,
  registerUser,
  revokeRefresh,
  rotateRefresh,
  setRefreshCookie,
} from "./service.js";
import { requireAuth } from "./guards.js";
import { unauthorized } from "../../common/errors.js";

export async function authRoutes(app: FastifyInstance, env: Env): Promise<void> {
  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const { user, accessToken, refreshRaw, refreshExpires } = await registerUser(env, body);
    setRefreshCookie(reply, env, refreshRaw, refreshExpires);
    return reply.code(201).send({ user, accessToken });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const { user, accessToken, refreshRaw, refreshExpires } = await loginUser(
      env, body.identifier, body.password,
    );
    setRefreshCookie(reply, env, refreshRaw, refreshExpires);
    return reply.send({ user, accessToken });
  });

  app.post("/auth/refresh", async (req, reply) => {
    const raw = req.cookies[env.REFRESH_COOKIE_NAME];
    if (!raw) throw unauthorized("Missing refresh token");
    const rotated = await rotateRefresh(env, raw);
    if (!rotated) {
      clearRefreshCookie(reply, env);
      throw unauthorized("Invalid or expired session");
    }
    setRefreshCookie(reply, env, rotated.refreshRaw, rotated.refreshExpires);
    return reply.send({ user: rotated.user, accessToken: rotated.accessToken });
  });

  app.post("/auth/logout", async (req, reply) => {
    await revokeRefresh(req.cookies[env.REFRESH_COOKIE_NAME]);
    clearRefreshCookie(reply, env);
    return reply.send({ ok: true });
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    return reply.send(await getMe(req.auth!.userId));
  });

  // Anti-enumeration: always 204, real email sending wired later.
  app.post("/auth/forgot-password", async (req, reply) => {
    forgotSchema.parse(req.body);
    req.log.info("password reset requested");
    return reply.code(204).send();
  });
}
