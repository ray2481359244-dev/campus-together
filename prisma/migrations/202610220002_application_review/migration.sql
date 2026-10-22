CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REJECT');
CREATE TABLE "ApplicationReview" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "applicantId" UUID NOT NULL,
  "reviewerId" UUID NOT NULL,
  "submission" INTEGER NOT NULL CHECK ("submission" > 0),
  "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision" > 0),
  "decision" "ReviewDecision" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "slotName" VARCHAR(30) NOT NULL,
  "recruitmentTitle" VARCHAR(60) NOT NULL,
  "eligibilitySnapshot" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApplicationReview_applicationId_applicantId_fkey" FOREIGN KEY ("applicationId", "applicantId") REFERENCES "Application"("id", "applicantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApplicationReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ApplicationReview_approval_evidence_check" CHECK ("decision" <> 'APPROVE' OR "eligibilitySnapshot" IS NOT NULL)
);
CREATE UNIQUE INDEX "ApplicationReview_applicationId_submission_key" ON "ApplicationReview"("applicationId", "submission");
CREATE UNIQUE INDEX "ApplicationReview_applicationId_expectedRevision_key" ON "ApplicationReview"("applicationId", "expectedRevision");
CREATE UNIQUE INDEX "ApplicationReview_id_applicantId_key" ON "ApplicationReview"("id", "applicantId");
CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "reviewId" UUID NOT NULL,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_reviewId_recipientId_fkey" FOREIGN KEY ("reviewId", "recipientId") REFERENCES "ApplicationReview"("id", "applicantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_reviewId_key" ON "Notification"("reviewId");
CREATE UNIQUE INDEX "Notification_reviewId_recipientId_key" ON "Notification"("reviewId", "recipientId");
CREATE INDEX "Notification_recipientId_createdAt_id_idx" ON "Notification"("recipientId", "createdAt", "id");
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");
