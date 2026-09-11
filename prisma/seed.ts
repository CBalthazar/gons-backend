import { promises as fs } from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { PrismaClient, type Role } from "@prisma/client";

const prisma = new PrismaClient();

const USERS: { email: string; username: string; password: string; roles: Role[] }[] = [
  { email: "buyer@gons.test", username: "buyer", password: "Buyer1234", roles: ["buyer"] },
  { email: "seller@gons.test", username: "seller", password: "Seller1234", roles: ["buyer", "seller"] },
  { email: "mod@gons.test", username: "mod", password: "Mod12345", roles: ["buyer", "moderator"] },
  { email: "admin@gons.test", username: "admin", password: "Admin1234", roles: ["buyer", "seller", "moderator", "admin"] },
];

async function main(): Promise<void> {
  for (const u of USERS) {
    const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email: u.email },
      update: { username: u.username, passwordHash, roles: u.roles },
      create: { email: u.email, username: u.username, passwordHash, roles: u.roles },
    });
  }
  const seller = await prisma.user.findUnique({ where: { email: "seller@gons.test" } });
  if (!seller) throw new Error("seed: seller missing");

  // Copy Khronos CC0 fixtures from frontend for local-driver dev.
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
  const fixtures = [
    { src: "../frontend/public/models/Duck.glb", key: "models/duck.glb" },
    { src: "../frontend/public/models/Fox.glb", key: "models/fox.glb" },
  ];
  for (const f of fixtures) {
    try {
      const buf = await fs.readFile(path.resolve(f.src));
      await fs.mkdir(path.dirname(path.join(uploadDir, f.key)), { recursive: true });
      await fs.writeFile(path.join(uploadDir, f.key), buf);
    } catch { /* fixtures optional in CI */ }
  }

  const count = await prisma.model.count();
  if (count === 0) {
    const duckSize = await statSafe(path.join(uploadDir, "models/duck.glb"));
    const foxSize = await statSafe(path.join(uploadDir, "models/fox.glb"));
    await prisma.model.createMany({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Duck",
          description: "Khronos CC0 sample (free, personal license)",
          fileKey: "models/duck.glb",
          fileFormat: "glb",
          fileSizeBytes: duckSize,
          priceCents: 0,
          currency: "EUR",
          license: "personal",
          tags: ["animal", "low-poly", "free"],
          status: "published",
          authorId: seller.id,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Fox",
          description: "Khronos CC0 sample (commercial license)",
          fileKey: "models/fox.glb",
          fileFormat: "glb",
          fileSizeBytes: foxSize,
          priceCents: 499,
          currency: "EUR",
          license: "commercial",
          tags: ["animal", "low-poly"],
          status: "published",
          authorId: seller.id,
        },
      ],
    });
  }
  console.log("Seed OK: 4 users + catalog fixtures");
}

async function statSafe(p: string): Promise<number | null> {
  try {
    const s = await fs.stat(p);
    return s.size;
  } catch {
    return null;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
