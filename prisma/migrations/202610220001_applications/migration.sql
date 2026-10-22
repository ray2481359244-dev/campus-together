CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
CREATE TABLE "Application" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "applicantId" UUID NOT NULL,
  "slotId" UUID NOT NULL,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "message" VARCHAR(1000) NOT NULL,
  "timeConfirmed" BOOLEAN NOT NULL,
  "eligibilitySnapshot" JSONB NOT NULL,
  "submissionHash" CHAR(64) NOT NULL,
  "submission" INTEGER NOT NULL DEFAULT 1 CHECK ("submission" > 0),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Application_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Application_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Application_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Application_slotId_teamId_fkey" FOREIGN KEY ("slotId", "teamId") REFERENCES "TeamSlot"("id", "teamId") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Application_teamId_applicantId_key" ON "Application"("teamId", "applicantId");
CREATE UNIQUE INDEX "Application_id_applicantId_key" ON "Application"("id", "applicantId");
CREATE INDEX "Application_applicantId_status_submittedAt_idx" ON "Application"("applicantId", "status", "submittedAt");
CREATE INDEX "Application_teamId_status_idx" ON "Application"("teamId", "status");
CREATE TABLE "ApplicationRequest" (
  "applicantId" UUID NOT NULL,
  "requestKey" UUID NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "applicationId" UUID NOT NULL,
  "submission" INTEGER NOT NULL CHECK ("submission" > 0),
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationRequest_pkey" PRIMARY KEY ("applicantId", "requestKey"),
  CONSTRAINT "ApplicationRequest_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ApplicationRequest_applicationId_applicantId_fkey" FOREIGN KEY ("applicationId", "applicantId") REFERENCES "Application"("id", "applicantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ApplicationRequest_applicationId_idx" ON "ApplicationRequest"("applicationId");
