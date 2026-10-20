CREATE TABLE "RecruitmentCreateRequest" (
    "authorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "recruitmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecruitmentCreateRequest_pkey" PRIMARY KEY ("authorId", "requestKey"),
    CONSTRAINT "RecruitmentCreateRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecruitmentCreateRequest_recruitmentId_fkey" FOREIGN KEY ("recruitmentId") REFERENCES "Recruitment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RecruitmentCreateRequest_recruitmentId_key" ON "RecruitmentCreateRequest"("recruitmentId");

-- Keep the exact request identity and original creation time of existing drafts/publications.
INSERT INTO "RecruitmentCreateRequest" ("authorId", "requestKey", "requestHash", "recruitmentId", "createdAt")
SELECT "authorId", "createRequestKey", "createRequestHash", "id", "createdAt" FROM "Recruitment";
