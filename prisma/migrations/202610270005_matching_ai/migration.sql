CREATE TABLE "AiRequest" (
 "id" UUID NOT NULL PRIMARY KEY,"userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "requestKey" UUID NOT NULL,"operation" VARCHAR(10) NOT NULL CHECK ("operation" IN ('DRAFT','EXPLAIN')),
 "requestHash" VARCHAR(64) NOT NULL,"attempted" BOOLEAN NOT NULL DEFAULT false,"fallback" JSONB NOT NULL,"result" JSONB,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AiRequest_userId_requestKey_key" ON "AiRequest"("userId","requestKey");
CREATE INDEX "AiRequest_userId_operation_createdAt_idx" ON "AiRequest"("userId","operation","createdAt");
CREATE INDEX "AiRequest_attempted_createdAt_idx" ON "AiRequest"("attempted","createdAt");
