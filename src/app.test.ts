import { describe, expect, it } from "vitest";
import { parseTags } from "./modules/catalog/schemas.js";
import { assertValidGlb } from "./modules/storage/storage.js";
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
