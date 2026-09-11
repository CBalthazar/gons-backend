import { z } from "zod";

export const catalogQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  sort: z.enum(["trending", "newest", "price-asc", "price-desc"]).default("trending"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const uploadFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(5000).optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217").default("EUR"),
  license: z.enum(["personal", "commercial", "extended"]).default("personal"),
  tags: z.string().max(500).optional(), // csv or JSON array
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export function parseTags(input?: string): string[] {
  if (!input) return [];
  const t = input.trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  } catch { /* not JSON, fall through to csv */ }
  return t.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
}

export function parseTagsParam(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : input.split(",");
  return arr.flatMap((s) => s.split(",")).map((s) => s.trim().toLowerCase()).filter(Boolean);
}
