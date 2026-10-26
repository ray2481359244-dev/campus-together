ALTER TABLE "Team" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  ADD COLUMN "startedAt" TIMESTAMPTZ(3), ADD COLUMN "completedAt" TIMESTAMPTZ(3), ADD COLUMN "cancelledAt" TIMESTAMPTZ(3);
CREATE TYPE "TeamActionKind" AS ENUM ('TRANSFER', 'START', 'COMPLETE', 'CANCEL');
CREATE TABLE "TeamAction" (
  "id" UUID NOT NULL PRIMARY KEY,
  "teamId" UUID NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actorId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "kind" "TeamActionKind" NOT NULL,
  "targetMemberId" UUID, "targetRevision" INTEGER,
  "captainUserId" UUID NOT NULL,
  "fromStatus" "TeamStatus" NOT NULL, "toStatus" "TeamStatus" NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "recruitmentTitle" VARCHAR(60) NOT NULL,
  "expiredCount" INTEGER NOT NULL CHECK ("expiredCount" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamAction_target_check" CHECK (("kind" = 'TRANSFER' AND "targetMemberId" IS NOT NULL AND "targetRevision" IS NOT NULL AND "targetRevision" > 0) OR ("kind" <> 'TRANSFER' AND "targetMemberId" IS NULL AND "targetRevision" IS NULL))
);
CREATE UNIQUE INDEX "TeamAction_teamId_expectedRevision_key" ON "TeamAction"("teamId", "expectedRevision");
CREATE TABLE "TeamActionNotice" (
  "id" UUID NOT NULL PRIMARY KEY,
  "actionId" UUID NOT NULL REFERENCES "TeamAction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recipientId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "applicationId" UUID,
  "slotName" VARCHAR(30) NOT NULL
);
CREATE UNIQUE INDEX "TeamActionNotice_actionId_recipientId_key" ON "TeamActionNotice"("actionId", "recipientId");
CREATE UNIQUE INDEX "TeamActionNotice_id_recipientId_key" ON "TeamActionNotice"("id", "recipientId");
ALTER TABLE "Notification" ADD COLUMN "actionNoticeId" UUID;
CREATE UNIQUE INDEX "Notification_actionNoticeId_key" ON "Notification"("actionNoticeId");
CREATE UNIQUE INDEX "Notification_actionNoticeId_recipientId_key" ON "Notification"("actionNoticeId", "recipientId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actionNoticeId_recipientId_fkey" FOREIGN KEY ("actionNoticeId", "recipientId") REFERENCES "TeamActionNotice"("id", "recipientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_source_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_source_check" CHECK (
  ("actionNoticeId" IS NULL AND (
    ("reviewId" IS NOT NULL AND "memberChangeId" IS NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
    ("reviewId" IS NULL AND "memberChangeId" IS NOT NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
    ("reviewId" IS NULL AND "memberChangeId" IS NULL AND "closureId" IS NOT NULL AND "teamId" IS NOT NULL AND "applicationId" IS NOT NULL)
  )) OR
  ("actionNoticeId" IS NOT NULL AND "reviewId" IS NULL AND "memberChangeId" IS NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL)
);
