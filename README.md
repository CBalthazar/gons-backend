# GONS backend

`Fastify 5 + TypeScript + zod + Prisma (Postgres) + Redis + S3/MinIO`. Matches `../frontend` contract.

## Quickstart

```sh
cp .env.example .env
npm install
npm run db:up            # postgres + redis + minio
npx prisma migrate dev   # creates tables
npm run prisma:seed      # buyer/seller/mod/admin@gons.test + Duck/Fox
npm run dev              # :3000, docs at /docs
```

Frontend integration:

```sh
# ../frontend/.env
VITE_API_URL=http://localhost:3000/api/v1
VITE_USE_MOCK_AUTH=false
```

> Frontend must send `withCredentials:true`, keep `accessToken` in memory (Pinia),
> and silent-refresh via `POST /auth/refresh` on `401` (see plan).

## Auth model

* `POST /auth/register|login -> {user,accessToken}` + `HttpOnly;SameSite=Lax` refresh cookie scoped to `/api/v1/auth`.
* `POST /auth/refresh` rotates (reuse detection revokes family).
* `GET /auth/me` via `Authorization: Bearer <access>`.
* `POST /auth/logout`, `POST /auth/forgot-password -> 204` (anti-enumeration).

## Catalog

* `GET /models?search&tags=a,b&sort=trending|newest|price-asc|price-desc&page&pageSize -> Paginated<Model3D>` (published only).
* `GET /models/:id`, `GET /models/:id/download (auth) -> {url}` short-lived signed URL.
* `POST /models (seller|admin, multipart file=.glb + preview? + fields)` -> `pending`.
* `GET /moderation/queue`, `POST /moderation/:id/{approve,reject} (moderator|admin)`.

`.glb` validated by magic + `MAX_MODEL_BYTES` (default 50MB). Local driver serves `/uploads/*`; S3 driver uses presigned URLs when `STORAGE_DRIVER=s3`.
