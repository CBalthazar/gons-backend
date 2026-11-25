import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ZodError } from "zod";
import { loadEnv, corsOrigins, type Env } from "./env.js";
import { buildLogger } from "./common/logger.js";
import { HttpError } from "./common/errors.js";
import {
  buildStorage,
  isPrivateKey,
  verifyLocalSignature,
} from "./modules/storage/storage.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { moderationRoutes } from "./modules/moderation/routes.js";
import { sellerRoutes } from "./modules/seller/routes.js";

export async function buildApp(env: Env = loadEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: buildLogger(env.NODE_ENV === "development"),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: corsOrigins(env),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: env.MAX_MODEL_BYTES, files: 2, fields: 20 },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  await app.register(swagger, {
    openapi: {
      info: { title: "GONS API", version: "0.1.0" },
      servers: [{ url: env.API_PREFIX }],
    },
  });
  // API docs are a dev aid: not exposed in production.
  if (env.NODE_ENV !== "production") {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ message: "Validation failed", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ message: err.message });
    }
    const status =
      (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ message: (err as Error).message || "Request error" });
    }
    app.log.error(err);
    return reply.code(500).send({ message: "Internal server error" });
  });

  app.get("/health", () => ({ ok: true }));

  const storage = buildStorage(env);

  // Serve local uploads statically (local driver only).
  if (env.STORAGE_DRIVER === "local") {
    const { promises: fs } = await import("node:fs");
    await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
    app.get("/uploads/*", async (req, reply) => {
      const path = await import("node:path");
      const { createReadStream } = await import("node:fs");
      const key = (req.params as { "*": string })["*"];
      if (key.includes(".."))
        return reply.code(400).send({ message: "Bad path" });
      if (isPrivateKey(key)) {
        const { exp, sig } = req.query as { exp?: string; sig?: string };
        if (!verifyLocalSignature(env.JWT_SECRET, key, exp, sig)) {
          return reply.code(403).send({ message: "Invalid or expired link" });
        }
      }
      const file = path.resolve(env.UPLOAD_DIR, key);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile())
          return reply.code(404).send({ message: "Not found" });
        const ext = path.extname(file).toLowerCase();

        let type;
        switch (ext) {
          case ".glb":
            type = "model/gltf-binary";
            break;
          case ".png":
            type = "image/png";
            break;
          default:
            type = "application/octet-stream";
        }
        reply.header("Content-Type", type).header("Content-Length", stat.size);
        reply.header("Access-Control-Allow-Origin", "*");
        return reply.send(createReadStream(file));
      } catch {
        return reply.code(404).send({ message: "Not found" });
      }
    });
  }

  // Stricter rate limit on password endpoints (brute-force protection).
  await app.register(
    async (scoped) => {
      await scoped.register(rateLimit, { max: 20, timeWindow: "1 minute" });
      authRoutes(scoped, env);
    },
    { prefix: env.API_PREFIX },
  );
  await app.register((scoped) => catalogRoutes(scoped, env, storage), {
    prefix: env.API_PREFIX,
  });
  await app.register((scoped) => sellerRoutes(scoped), {
    prefix: env.API_PREFIX,
  });
  await app.register((scoped) => moderationRoutes(scoped, env, storage), {
    prefix: env.API_PREFIX,
  });

  return app;
}
