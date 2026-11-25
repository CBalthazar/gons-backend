import { createHmac } from "node:crypto";
import { assertNotSelfDecision } from "./modules/seller/routes.js";
import { describe, expect, it, vi } from "vitest";
import { parseTags } from "./modules/catalog/schemas.js";
import { canAccessFile } from "./modules/catalog/service.js";
import { prisma } from "./common/prisma.js";
import { assertValidGlb, isPrivateKey, verifyLocalSignature } from "./modules/storage/storage.js";
import { hashToken, newRefreshToken } from "./modules/auth/tokens.js";

const glb = (size = 20): Buffer => {
  const b = Buffer.alloc(size);
  b.write("glTF", 0);
  return b;
};

describe("catalog tags", () => {
  it("parses csv", () => {
    expect(parseTags("Animal, low-poly ,,FREE")).toEqual(["animal", "low-poly", "free"]);
  });
  it("parses JSON array", () => {
    expect(parseTags('["A","b"]')).toEqual(["a", "b"]);
  });
});

describe("glb validation", () => {
  it("accepts magic", () => {
    expect(() => assertValidGlb(glb(), 100)).not.toThrow();
  });
  it("rejects bad magic", () => {
    expect(() => assertValidGlb(Buffer.alloc(20), 100)).toThrow();
  });
  it("rejects oversize", () => {
    expect(() => assertValidGlb(glb(200), 100)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("hashes opaquely", () => {
    const { raw, hash } = newRefreshToken();
    expect(hashToken(raw)).toBe(hash);
    expect(raw).not.toContain(hash.slice(0, 8));
  });
});

describe("private file links (local driver)", () => {
  const secret = "s".repeat(32);
  const key = "models/abc.glb";
  const sig = (exp: number) =>
    createHmac("sha256", secret).update(`${key}.${exp}`).digest("base64url");
  const future = () => Math.floor(Date.now() / 1000) + 60;

  it("accepts a valid unexpired signature", () => {
    const exp = future();
    expect(verifyLocalSignature(secret, key, String(exp), sig(exp))).toBe(true);
  });
  it("rejects missing, expired, forged and other-key signatures", () => {
    const exp = future();
    expect(verifyLocalSignature(secret, key, undefined, undefined)).toBe(false);
    expect(verifyLocalSignature(secret, key, String(exp - 120), sig(exp - 120))).toBe(false);
    expect(verifyLocalSignature(secret, key, String(exp), "forged")).toBe(false);
    expect(verifyLocalSignature(secret, "models/other.glb", String(exp), sig(exp))).toBe(false);
  });
  it("treats model files as private and previews as public", () => {
    expect(isPrivateKey("models/abc.glb")).toBe(true);
    expect(isPrivateKey("previews/abc")).toBe(false);
  });
});

describe("file entitlement", () => {
  const model = { id: "m1", authorId: "author", priceCents: 500 };
  it("allows author and staff, denies unrelated buyer of paid model", async () => {
    vi.spyOn(prisma.purchase, "findUnique").mockResolvedValue(null);
    expect(await canAccessFile(model, { userId: "author", roles: ["seller"] })).toBe(true);
    expect(await canAccessFile(model, { userId: "x", roles: ["moderator"] })).toBe(true);
    expect(await canAccessFile(model, { userId: "x", roles: ["buyer"] })).toBe(false);
  });
  it("allows a buyer who purchased, and anyone for free models", async () => {
    vi.spyOn(prisma.purchase, "findUnique").mockResolvedValue({ id: "p" } as never);
    expect(await canAccessFile(model, { userId: "x", roles: ["buyer"] })).toBe(true);
    vi.spyOn(prisma.purchase, "findUnique").mockResolvedValue(null);
    expect(await canAccessFile({ ...model, priceCents: 0 }, { userId: "x", roles: ["buyer"] })).toBe(true);
  });
});

describe("seller request decisions", () => {
  it("forbids deciding your own request, allows others", () => {
    expect(() => assertNotSelfDecision("u1", "u1")).toThrow(/own request/);
    expect(() => assertNotSelfDecision("u1", "u2")).not.toThrow();
  });
});
