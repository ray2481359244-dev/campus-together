ALTER TABLE "ChatSpace" ADD COLUMN "lastSeq" INTEGER NOT NULL DEFAULT 0 CHECK ("lastSeq" >= 0), ADD COLUMN "announcement" VARCHAR(2000) NOT NULL DEFAULT '', ADD COLUMN "announcementRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "TeamMember" ADD COLUMN "lastReadSeq" INTEGER NOT NULL DEFAULT 0 CHECK ("lastReadSeq" >= 0);
CREATE TABLE "ChatMessage" (
 "id" UUID NOT NULL PRIMARY KEY, "teamId" UUID NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "seq" INTEGER NOT NULL CHECK ("seq" > 0), "senderId" UUID REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "clientMessageId" UUID, "systemEventId" UUID, "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('TEXT','SYSTEM')),
 "nickname" VARCHAR(80) NOT NULL, "body" VARCHAR(2000), "bodyHash" VARCHAR(64), "redactsMessageId" UUID,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deletedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "ChatMessage_teamId_seq_key" ON "ChatMessage"("teamId","seq");
CREATE UNIQUE INDEX "ChatMessage_teamId_senderId_clientMessageId_key" ON "ChatMessage"("teamId","senderId","clientMessageId");
CREATE UNIQUE INDEX "ChatMessage_systemEventId_key" ON "ChatMessage"("systemEventId");
CREATE INDEX "ChatMessage_teamId_createdAt_idx" ON "ChatMessage"("teamId","createdAt");
