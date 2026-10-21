-- CreateEnum
CREATE TYPE "RepositoryStatus" AS ENUM ('PENDING', 'CLONING', 'INDEXING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "githubOwner" TEXT NOT NULL,
    "githubName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "status" "RepositoryStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Repository_userId_createdAt_idx" ON "Repository"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Repository_status_idx" ON "Repository"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_userId_url_key" ON "Repository"("userId", "url");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
