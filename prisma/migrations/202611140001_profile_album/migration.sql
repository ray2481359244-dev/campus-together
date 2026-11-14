CREATE TYPE "PhotoVisibility" AS ENUM ('PRIVATE', 'CAMPUS');

CREATE TABLE "ProfilePhoto" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "visibility" "PhotoVisibility" NOT NULL DEFAULT 'PRIVATE',
    "position" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" BYTEA,
    "thumbnail" BYTEA,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfilePhoto_ownerId_requestKey_key" ON "ProfilePhoto"("ownerId", "requestKey");
CREATE INDEX "ProfilePhoto_ownerId_removedAt_position_idx" ON "ProfilePhoto"("ownerId", "removedAt", "position");
CREATE INDEX "ProfilePhoto_ownerId_createdAt_idx" ON "ProfilePhoto"("ownerId", "createdAt");

ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
