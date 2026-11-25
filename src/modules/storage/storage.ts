import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../../env.js";

export interface Storage {
  save(key: string, body: Buffer, contentType: string): Promise<void>;
  /** URL the browser can load for a stored object (presigned for S3, so the bucket stays private). */
  assetUrl(key: string): Promise<string>;
  /** Short-lived URL to the private model file, as an attachment. Only call after an entitlement check. */
  signedDownloadUrl(key: string, filename: string): Promise<string>;
  /** Short-lived URL to the private model file for inline 3D viewing. Only call after an entitlement check. */
  signedViewUrl(key: string): Promise<string>;
  readPath?(key: string): string;
}

const sign = (secret: string, key: string, exp: number): string =>
  createHmac("sha256", secret).update(`${key}.${exp}`).digest("base64url");

/** Verifies the `exp`/`sig` query of a local-driver private file URL. */
export function verifyLocalSignature(
  secret: string,
  key: string,
  exp: unknown,
  sig: unknown,
): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000 || typeof sig !== "string")
    return false;
  const a = Buffer.from(sign(secret, key, e));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Private objects (full model files) must never be served through public asset URLs. */
export const isPrivateKey = (key: string): boolean => key.startsWith("models/");

const GLB_MAGIC = Buffer.from([0x67, 0x6c, 0x54, 0x46]); // "glTF"

export function assertValidGlb(buf: Buffer, maxBytes: number): void {
  if (buf.length > maxBytes) {
    const err = new Error(
      `File too large (${buf.length} > ${maxBytes})`,
    ) as Error & { status?: number };
    err.status = 413;
    throw err;
  }
  if (buf.length < 12 || !buf.subarray(0, 4).equals(GLB_MAGIC)) {
    const err = new Error("Invalid .glb file (bad magic)") as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }
}

export function buildStorage(env: Env): Storage {
  if (env.STORAGE_DRIVER === "s3") {
    const client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? {
            credentials: {
              accessKeyId: env.S3_ACCESS_KEY,
              secretAccessKey: env.S3_SECRET_KEY,
            },
          }
        : {}),
    });
    return {
      async save(key, body, contentType) {
        await client.send(
          new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
        );
      },
      async assetUrl(key) {
        return getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
          }),
          { expiresIn: env.ASSET_URL_TTL },
        );
      },
      async signedViewUrl(key) {
        return getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ResponseContentType: "model/gltf-binary",
          }),
          { expiresIn: env.SIGNED_URL_TTL },
        );
      },
      async signedDownloadUrl(key, filename) {
        return getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ResponseContentDisposition: `attachment; filename="${filename}"`,
            ResponseContentType: "model/gltf-binary",
          }),
          { expiresIn: env.SIGNED_URL_TTL },
        );
      },
    };
  }
  const dir = path.resolve(env.UPLOAD_DIR);
  return {
    async save(key, body) {
      await fs.mkdir(path.dirname(path.join(dir, key)), { recursive: true });
      await fs.writeFile(path.join(dir, key), body);
    },
    async assetUrl(key) {
      return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/uploads/${key}`;
    },
    async signedViewUrl(key) {
      const exp = Math.floor(Date.now() / 1000) + env.SIGNED_URL_TTL;
      return `${await this.assetUrl(key)}?exp=${exp}&sig=${sign(env.JWT_SECRET, key, exp)}`;
    },
    async signedDownloadUrl(key) {
      return this.signedViewUrl(key);
    },
    readPath: (key) => path.join(dir, key),
  };
}
