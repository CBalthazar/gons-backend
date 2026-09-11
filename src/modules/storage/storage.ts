import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../../env.js";

export interface Storage {
  save(key: string, body: Buffer, contentType: string): Promise<void>;
  publicUrl(key: string): string;
  signedDownloadUrl(key: string, filename: string): Promise<string>;
  readPath?(key: string): string;
}

const GLB_MAGIC = Buffer.from([0x67, 0x6c, 0x54, 0x46]); // "glTF"

export function assertValidGlb(buf: Buffer, maxBytes: number): void {
  if (buf.length > maxBytes) {
    const err = new Error(`File too large (${buf.length} > ${maxBytes})`) as Error & { status?: number };
    err.status = 413;
    throw err;
  }
  if (buf.length < 12 || !buf.subarray(0, 4).equals(GLB_MAGIC)) {
    const err = new Error("Invalid .glb file (bad magic)") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
}

export function buildStorage(env: Env): Storage {
  if (env.STORAGE_DRIVER === "s3") {
    const client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: env.S3_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY ?? "" }
        : undefined,
    });
    return {
      async save(key, body, contentType) {
        await client.send(new PutObjectCommand({
          Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType,
        }));
      },
      publicUrl: (key) =>
        env.S3_ENDPOINT
          ? `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`
          : `s3://${env.S3_BUCKET}/${key}`,
      async signedDownloadUrl(key, filename) {
        return getSignedUrl(client, new GetObjectCommand({
          Bucket: env.S3_BUCKET, Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
          ResponseContentType: "model/gltf-binary",
        }), { expiresIn: env.SIGNED_URL_TTL });
      },
    };
  }
  const dir = path.resolve(env.UPLOAD_DIR);
  return {
    async save(key, body) {
      await fs.mkdir(path.dirname(path.join(dir, key)), { recursive: true });
      await fs.writeFile(path.join(dir, key), body);
    },
    publicUrl: (key) => `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/uploads/${key}`,
    async signedDownloadUrl(key) {
      // Local driver: auth already checked by route; short TTL enforced via signed query is skipped in dev.
      return this.publicUrl(key);
    },
    readPath: (key) => path.join(dir, key),
  };
}

export { createReadStream };
