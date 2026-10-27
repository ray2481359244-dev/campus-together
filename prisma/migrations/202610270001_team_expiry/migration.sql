ALTER TYPE "TeamActionKind" ADD VALUE 'EXPIRE';
ALTER TABLE "TeamAction" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "Team" ADD COLUMN "expiredAt" TIMESTAMPTZ(3);
CREATE INDEX "Team_status_id_idx" ON "Team"("status", "id");
