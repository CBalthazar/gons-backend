import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../env.js";
import { requireAuth, requireRole } from "../auth/guards.js";
import {
  catalogQuerySchema,
  parseTags,
  uploadFieldsSchema,
} from "./schemas.js";
import { canAccessFile, getModel, listModels } from "./service.js";
import { assertValidGlb, type Storage } from "../storage/storage.js";
import { prisma } from "../../common/prisma.js";
import { badRequest, forbidden, notFound } from "../../common/errors.js";

const GLB_MIME = "model/gltf-binary";

export function catalogRoutes(
  app: FastifyInstance,
  env: Env,
  storage: Storage,
): void {
  app.get("/models", async (req, reply) => {
    const query = catalogQuerySchema.parse(req.query);
    return reply.send(await listModels(query, storage));
  });

  app.get("/models/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    let viewer: { userId: string; roles: string[] } | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      // Best-effort: public route, but authors/moderators may preview pending models.
      // Full verification happens in service; here we just forward claims if verifiable.
      try {
        const { verifyAccessToken } = await import("../auth/tokens.js");
        const p = await verifyAccessToken(header.slice(7));
        viewer = { userId: p.sub, roles: p.roles };
      } catch {
        /* remain anonymous */
      }
    }
    return reply.send(await getModel(id, storage, viewer));
  });

  const findPublished = async (id: string) => {
    const m = await prisma.model.findUnique({ where: { id } });
    if (m?.status !== "published") throw notFound("Model not found");
    return m;
  };

  // Simulated purchase (no payment provider yet): records ownership. Free models are claimed at no cost.
  app.post(
    "/models/:id/purchase",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const m = await findPublished(id);
      if (m.authorId === req.auth!.userId)
        return reply.send({ modelId: id, owned: true });
      const purchase = await prisma.purchase.upsert({
        where: { userId_modelId: { userId: req.auth!.userId, modelId: id } },
        update: {},
        create: {
          userId: req.auth!.userId,
          modelId: id,
          pricePaidCents: m.priceCents,
          currency: m.currency,
        },
      });
      return reply.code(201).send({
        id: purchase.id,
        modelId: id,
        createdAt: purchase.createdAt.toISOString(),
      });
    },
  );

  // Entitled 3D preview: short-lived URL to the GLB for the viewer. Not counted as a download.
  app.get(
    "/models/:id/view",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const m = await prisma.model.findUnique({ where: { id } });
      if (!m) throw notFound("Model not found");
      const isStaff = req.auth!.roles.some(
        (r) => r === "admin" || r === "moderator",
      );
      if (
        m.status !== "published" &&
        m.authorId !== req.auth!.userId &&
        !isStaff
      )
        throw notFound("Model not found");
      if (!(await canAccessFile(m, req.auth!)))
        throw forbidden("Purchase required");
      return reply.send({ url: await storage.signedViewUrl(m.fileKey) });
    },
  );

  // Entitled download: requires ownership (purchase), authorship, or staff role.
  app.get(
    "/models/:id/download",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const m = await findPublished(id);
      if (!(await canAccessFile(m, req.auth!)))
        throw forbidden("Purchase required");
      if (m.authorId !== req.auth!.userId) {
        await prisma.model.update({
          where: { id },
          data: { downloadCount: { increment: 1 } },
        });
      }
      const filename = `${m.name.replace(/[^\w-]+/g, "_")}.glb`;
      return reply.send({
        url: await storage.signedDownloadUrl(m.fileKey, filename),
      });
    },
  );

  app.post(
    "/models",
    { preHandler: [requireAuth, requireRole("seller", "admin")] },
    async (req, reply) => {
      const parts = req.parts();
      const fields: Record<string, string> = {};
      let fileBuf: Buffer | null = null;
      // let fileMime = GLB_MIME;
      let previewBuf: Buffer | null = null;
      let previewMime = "image/png";

      for await (const part of parts) {
        if (part.type === "file") {
          const buf = await part.toBuffer();
          if (part.fieldname === "file") {
            fileBuf = buf;
            // fileMime = part.mimetype || GLB_MIME;
          } else if (part.fieldname === "preview") {
            previewBuf = buf;
            previewMime = part.mimetype || previewMime;
          }
          if (buf.length > env.MAX_MODEL_BYTES && part.fieldname === "file") {
            throw badRequest("File exceeds 50MB limit");
          }
        } else {
          fields[part.fieldname] = part.value as string;
        }
      }
      if (!fileBuf) throw badRequest("Missing 'file' (.glb)");
      assertValidGlb(fileBuf, env.MAX_MODEL_BYTES);

      const parsed = uploadFieldsSchema.parse({
        name: fields.name,
        description: fields.description,
        priceCents: fields.priceCents,
        currency: fields.currency,
        license: fields.license,
        tags: fields.tags,
      });

      const id = randomUUID();
      const fileKey = `models/${id}.glb`;
      await storage.save(fileKey, fileBuf, GLB_MIME);
      let previewKey: string | undefined;
      if (previewBuf) {
        previewKey = `previews/${id}`;
        await storage.save(previewKey, previewBuf, previewMime);
      }

      const created = await prisma.model.create({
        data: {
          id,
          name: parsed.name,
          description: parsed.description ?? null,
          previewKey: previewKey ?? null,
          fileKey,
          fileFormat: "glb",
          fileSizeBytes: fileBuf.length,
          priceCents: parsed.priceCents,
          currency: parsed.currency,
          license: parsed.license as never,
          tags: parseTags(parsed.tags),
          status: "pending",
          authorId: req.auth!.userId,
        },
        include: {
          author: { select: { id: true, username: true, avatarUrl: true } },
        },
      });
      const { toModel3D } = await import("./service.js");
      return reply.code(201).send(await toModel3D(created, storage));
    },
  );
}
