ALTER TABLE "Team" ADD COLUMN "archiveUntil" TIMESTAMPTZ(3);
ALTER TABLE "ChatSpace" ADD COLUMN "purgedAt" TIMESTAMPTZ(3);
UPDATE "Team" t SET "archiveUntil" = COALESCE(t."completedAt", t."cancelledAt", t."expiredAt",
 (SELECT r."joinDeadline" FROM "Recruitment" r WHERE r."id"=t."recruitmentId" AND t."status"='EXPIRED'), t."createdAt") + interval '30 days'
 WHERE t."status" IN ('COMPLETED','CANCELLED','EXPIRED');
CREATE INDEX "Team_archiveUntil_id_idx" ON "Team"("archiveUntil","id");
