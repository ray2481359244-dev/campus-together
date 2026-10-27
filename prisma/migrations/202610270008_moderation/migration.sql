-- AlterTable
ALTER TABLE "Recruitment" ADD COLUMN     "hiddenAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "noticeId" UUID;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "targetType" VARCHAR(20) NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "resolution" VARCHAR(500) NOT NULL DEFAULT '',
    "handledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" UUID NOT NULL,
    "adminId" UUID,
    "requestKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "targetType" VARCHAR(20) NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "category" "Category" NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "topicId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicAlias" (
    "id" UUID NOT NULL,
    "topicId" UUID NOT NULL,
    "category" "Category" NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,

    CONSTRAINT "TopicAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "sourceKey" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "recruitmentId" UUID,
    "teamId" UUID,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_id_idx" ON "Report"("status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_requestKey_key" ON "Report"("reporterId", "requestKey");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_id_idx" ON "ModerationAction"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationAction_adminId_requestKey_key" ON "ModerationAction"("adminId", "requestKey");

-- CreateIndex
CREATE INDEX "TopicRequest_status_createdAt_id_idx" ON "TopicRequest"("status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRequest_userId_requestKey_key" ON "TopicRequest"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "TopicAlias_category_normalizedName_key" ON "TopicAlias"("category", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_recipientId_sourceKey_key" ON "Notice"("recipientId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_id_recipientId_key" ON "Notice"("id", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_noticeId_key" ON "Notification"("noticeId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_noticeId_recipientId_key" ON "Notification"("noticeId", "recipientId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_noticeId_recipientId_fkey" FOREIGN KEY ("noticeId", "recipientId") REFERENCES "Notice"("id", "recipientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRequest" ADD CONSTRAINT "TopicRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRequest" ADD CONSTRAINT "TopicRequest_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicAlias" ADD CONSTRAINT "TopicAlias_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_source_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_source_check" CHECK (
 ("noticeId" IS NOT NULL AND num_nonnulls("reviewId","memberChangeId","closureId","actionNoticeId","teamId","applicationId")=0) OR ("noticeId" IS NULL AND (
  ("actionNoticeId" IS NULL AND (
    ("reviewId" IS NOT NULL AND "memberChangeId" IS NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
    ("reviewId" IS NULL AND "memberChangeId" IS NOT NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL) OR
    ("reviewId" IS NULL AND "memberChangeId" IS NULL AND "closureId" IS NOT NULL AND "teamId" IS NOT NULL AND "applicationId" IS NOT NULL)
  )) OR
  ("actionNoticeId" IS NOT NULL AND "reviewId" IS NULL AND "memberChangeId" IS NULL AND "closureId" IS NULL AND "teamId" IS NULL AND "applicationId" IS NULL)
))
);

ALTER TABLE "Report" ADD CONSTRAINT "Report_status_check" CHECK ("status" IN ('PENDING','RESOLVED','DISMISSED'));
ALTER TABLE "TopicRequest" ADD CONSTRAINT "TopicRequest_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED'));
CREATE UNIQUE INDEX "TopicRequest_pending_name" ON "TopicRequest" ("category", "normalizedName") WHERE "status"='PENDING';
