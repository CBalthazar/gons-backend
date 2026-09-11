import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Storage } from "../storage/storage.js";
import { requireAuth, requireRole } from "../auth/guards.js";
import { prisma } from "../../common/prisma.js";
import { notFound } from "../../common/errors.js";
import { toModel3D } from "../catalog/service.js";

const decisionSchema = z.object({ reason: z.string().max(2000).optional() });

export async function moderationRoutes(app: FastifyInstance, _env: unknown, storage: Storage): Promise<void> {
  app.get(
    "/moderation/queue",
    { preHandler: [requireAuth, requireRole("moderator", "admin")] },
    async (_req, reply) => {
      const rows = await prisma.model.findMany({
        where: { status: "pending" },
        include: { author: { select: { id: true, username: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return reply.send({ items: rows.map((m) => toModel3D(m, storage)), total: rows.length });
    },
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post(
      `/moderation/:id/${decision}`,
      { preHandler: [requireAuth, requireRole("moderator", "admin")] },
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const { reason } = decisionSchema.parse(req.body ?? {});
        const model = await prisma.model.findUnique({ where: { id } });
        if (!model) throw notFound("Model not found");
        const updated = await prisma.model.update({
          where: { id },
          data: { status: decision === "approve" ? "published" : "rejected" },
          include: { author: { select: { id: true, username: true, avatarUrl: true } } },
        });
        await prisma.moderationAction.create({
          data: {
            modelId: id,
            moderatorId: req.auth!.userId,
            decision,
            reason,
          },
        });
        return reply.send(toModel3D(updated, storage));
      },
    );
  }
}
