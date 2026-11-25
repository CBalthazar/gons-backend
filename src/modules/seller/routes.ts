import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth/guards.js";
import { prisma } from "../../common/prisma.js";
import { conflict, forbidden, notFound } from "../../common/errors.js";

const requestSchema = z.object({
  message: z.string().trim().max(1000).optional(),
});
const decisionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

/** Nobody decides their own seller request, whatever their role. */
export function assertNotSelfDecision(
  requesterId: string,
  deciderId: string,
): void {
  if (requesterId === deciderId)
    throw forbidden("You cannot decide your own request");
}

const toDto = (r: {
  id: string;
  userId: string;
  message: string | null;
  status: string;
  reason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  user?: { username: string };
}) => ({
  id: r.id,
  userId: r.userId,
  username: r.user?.username,
  message: r.message ?? undefined,
  status: r.status,
  reason: r.reason ?? undefined,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString(),
});

/** Becoming a seller: a user applies, a moderator/admin approves (grants the `seller` role). */
export function sellerRoutes(app: FastifyInstance): void {
  app.post(
    "/seller-requests",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { message } = requestSchema.parse(req.body ?? {});
      const userId = req.auth!.userId;
      if (req.auth!.roles.includes("seller"))
        throw conflict("You are already a seller");
      const open = await prisma.sellerRequest.findFirst({
        where: { userId, status: "pending" },
      });
      if (open) throw conflict("A request is already pending");
      const created = await prisma.sellerRequest.create({
        data: { userId, message: message ?? null },
      });
      return reply.code(201).send(toDto(created));
    },
  );

  app.get(
    "/seller-requests/me",
    { preHandler: requireAuth },
    async (req, reply) => {
      const last = await prisma.sellerRequest.findFirst({
        where: { userId: req.auth!.userId },
        orderBy: { createdAt: "desc" },
      });
      return reply.send(last ? toDto(last) : null);
    },
  );

  app.get(
    "/moderation/seller-requests",
    { preHandler: [requireAuth, requireRole("moderator", "admin")] },
    async (_req, reply) => {
      const rows = await prisma.sellerRequest.findMany({
        where: { status: "pending" },
        include: { user: { select: { username: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return reply.send({ items: rows.map(toDto), total: rows.length });
    },
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post(
      `/moderation/seller-requests/:id/${decision}`,
      { preHandler: [requireAuth, requireRole("moderator", "admin")] },
      async (req, reply) => {
        const { id } = req.params as { id: string };
        const { reason } = decisionSchema.parse(req.body ?? {});
        const r = await prisma.sellerRequest.findUnique({ where: { id } });
        if (!r) throw notFound("Request not found");
        if (r.status !== "pending") throw conflict("Request already decided");
        assertNotSelfDecision(r.userId, req.auth!.userId);
        const updated = await prisma.$transaction(async (tx) => {
          if (decision === "approve") {
            const u = await tx.user.findUniqueOrThrow({
              where: { id: r.userId },
              select: { roles: true },
            });
            if (!u.roles.includes("seller")) {
              await tx.user.update({
                where: { id: r.userId },
                data: { roles: { set: [...u.roles, "seller"] } },
              });
            }
          }
          return tx.sellerRequest.update({
            where: { id },
            data: {
              status: decision === "approve" ? "approved" : "rejected",
              deciderId: req.auth!.userId,
              decidedAt: new Date(),
              reason: reason ?? null,
            },
          });
        });
        return reply.send(toDto(updated));
      },
    );
  }
}
