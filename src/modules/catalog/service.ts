import type { Model, User } from "@prisma/client";
import { prisma } from "../../common/prisma.js";
import { notFound } from "../../common/errors.js";
import { parseTagsParam, type CatalogQuery } from "./schemas.js";
import type { Storage } from "../storage/storage.js";

export interface Model3D {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  fileUrl: string;
  fileFormat: string;
  fileSizeBytes?: number;
  priceCents: number;
  currency: string;
  license: string;
  tags: string[];
  author: { id: string; username: string; avatarUrl?: string };
  createdAt: string;
  updatedAt: string;
}

type ModelWithAuthor = Model & { author: Pick<User, "id" | "username" | "avatarUrl"> };

export function toModel3D(m: ModelWithAuthor, storage: Storage): Model3D {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? undefined,
    previewUrl: m.previewKey ? storage.publicUrl(m.previewKey) : undefined,
    fileUrl: storage.publicUrl(m.fileKey),
    fileFormat: m.fileFormat,
    fileSizeBytes: m.fileSizeBytes ?? undefined,
    priceCents: m.priceCents,
    currency: m.currency,
    license: m.license,
    tags: m.tags,
    author: {
      id: m.author.id,
      username: m.author.username,
      avatarUrl: m.author.avatarUrl ?? undefined,
    },
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const orderByFor = (sort: CatalogQuery["sort"]) => {
  switch (sort) {
    case "newest": return [{ createdAt: "desc" as const }];
    case "price-asc": return [{ priceCents: "asc" as const }];
    case "price-desc": return [{ priceCents: "desc" as const }];
    case "trending":
    default: return [{ downloadCount: "desc" as const }, { createdAt: "desc" as const }];
  }
};

export async function listModels(query: CatalogQuery, storage: Storage) {
  const tags = parseTagsParam(query.tags as string | string[] | undefined);
  const search = query.search?.trim();
  const where = {
    status: "published" as const,
    ...(tags.length ? { tags: { hasSome: tags } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
            { tags: { hasSome: [search.toLowerCase()] } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.model.count({ where }),
    prisma.model.findMany({
      where,
      include: { author: { select: { id: true, username: true, avatarUrl: true } } },
      orderBy: orderByFor(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map((m) => toModel3D(m, storage)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getModel(id: string, storage: Storage, viewer?: { userId: string; roles: string[] }) {
  const m = await prisma.model.findUnique({
    where: { id },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });
  if (!m) throw notFound("Model not found");
  const canSeeNonPublished =
    viewer && (viewer.userId === m.authorId || viewer.roles.includes("moderator") || viewer.roles.includes("admin"));
  if (m.status !== "published" && !canSeeNonPublished) throw notFound("Model not found");
  return toModel3D(m, storage);
}
