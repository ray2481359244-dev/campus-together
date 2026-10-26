ALTER TABLE "Team" ADD COLUMN "recruitmentClosedAt" TIMESTAMPTZ(3);
ALTER TABLE "TeamMember" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0);
CREATE UNIQUE INDEX "TeamMember_id_userId_key" ON "TeamMember"("id", "userId");
CREATE UNIQUE INDEX "Application_id_teamId_applicantId_key" ON "Application"("id", "teamId", "applicantId");
CREATE TYPE "MembershipChangeKind" AS ENUM ('LEFT', 'REMOVED');
CREATE TABLE "MembershipChange" (
  "id" UUID NOT NULL PRIMARY KEY,
  "memberId" UUID NOT NULL,
  "memberUserId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "kind" "MembershipChangeKind" NOT NULL,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "slotName" VARCHAR(30) NOT NULL,
  "recruitmentTitle" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipChange_memberId_memberUserId_fkey" FOREIGN KEY ("memberId", "memberUserId") REFERENCES "TeamMember"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MembershipChange_memberId_expectedRevision_key" ON "MembershipChange"("memberId", "expectedRevision");
CREATE UNIQUE INDEX "MembershipChange_id_memberUserId_key" ON "MembershipChange"("id", "memberUserId");
CREATE TABLE "RecruitmentClosure" (
  "id" UUID NOT NULL PRIMARY KEY,
  "teamId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "recruitmentTitle" VARCHAR(60) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentClosure_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecruitmentClosure_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "RecruitmentClosure" ADD COLUMN "expiredCount" INTEGER NOT NULL CHECK ("expiredCount" >= 0);
CREATE UNIQUE INDEX "RecruitmentClosure_teamId_key" ON "RecruitmentClosure"("teamId");
CREATE UNIQUE INDEX "RecruitmentClosure_id_teamId_key" ON "RecruitmentClosure"("id", "teamId");
ALTER TABLE "Notification" ALTER COLUMN "reviewId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "memberChangeId" UUID, ADD COLUMN "closureId" UUID, ADD COLUMN "teamId" UUID, ADD COLUMN "applicationId" UUID;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberChangeId_recipientId_fkey" FOREIGN KEY ("memberChangeId", "recipientId") REFERENCES "MembershipChange"("id", "memberUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_closureId_teamId_fkey" FOREIGN KEY ("closureId", "teamId") REFERENCES "RecruitmentClosure"("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_applicationId_teamId_recipientId_fkey" FOREIGN KEY ("applicationId", "teamId", "recipientId") REFERENCES "Application"("id", "teamId", "applicantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_source_check" CHECK (
  ("reviewId" IS NOT NULL AND "memberChangeId" IS NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
  ("reviewId" IS NULL AND "memberChangeId" IS NOT NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
  ("reviewId" IS NULL AND "memberChangeId" IS NULL AND "closureId" IS NOT NULL AND "teamId" IS NOT NULL AND "applicationId" IS NOT NULL)
);
CREATE UNIQUE INDEX "Notification_memberChangeId_key" ON "Notification"("memberChangeId");
CREATE UNIQUE INDEX "Notification_memberChangeId_recipientId_key" ON "Notification"("memberChangeId", "recipientId");
CREATE UNIQUE INDEX "Notification_closureId_recipientId_key" ON "Notification"("closureId", "recipientId");
