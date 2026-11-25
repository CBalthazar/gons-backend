-- CreateEnum
CREATE TYPE "SellerRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "pricePaidCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT,
    "status" "SellerRequestStatus" NOT NULL DEFAULT 'pending',
    "deciderId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "SellerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_modelId_idx" ON "Purchase"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_userId_modelId_key" ON "Purchase"("userId", "modelId");

-- CreateIndex
CREATE INDEX "SellerRequest_userId_idx" ON "SellerRequest"("userId");

-- CreateIndex
CREATE INDEX "SellerRequest_status_createdAt_idx" ON "SellerRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerRequest" ADD CONSTRAINT "SellerRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerRequest" ADD CONSTRAINT "SellerRequest_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
