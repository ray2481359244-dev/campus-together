-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('DIRECT', 'DISCUSSION');

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('REQUESTED', 'ACTIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "DiscussionJoinMode" AS ENUM ('OPEN', 'APPROVAL');

-- CreateEnum
CREATE TYPE "ConversationMemberStatus" AS ENUM ('ACTIVE', 'PENDING', 'LEFT', 'REMOVED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowMessageRequests" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "chatMuted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chatPinnedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "imageId" UUID,
ADD COLUMN     "mentionIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "replyToId" UUID,
ADD COLUMN     "sourceCommentId" UUID,
ADD COLUMN     "sourcePostId" UUID,
ADD COLUMN     "sourceRecruitmentId" UUID;

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE',
    "directKey" VARCHAR(73),
    "ownerId" UUID NOT NULL,
    "postId" UUID,
    "title" VARCHAR(80) NOT NULL DEFAULT '',
    "joinMode" "DiscussionJoinMode" NOT NULL DEFAULT 'OPEN',
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ConversationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAfterSeq" INTEGER NOT NULL DEFAULT 0,
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "pinnedAt" TIMESTAMPTZ(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID,
    "clientMessageId" UUID,
    "seq" INTEGER NOT NULL,
    "nickname" VARCHAR(80) NOT NULL,
    "body" VARCHAR(2000),
    "bodyHash" CHAR(64),
    "replyToId" UUID,
    "redactsMessageId" UUID,
    "sourcePostId" UUID,
    "sourceCommentId" UUID,
    "sourceRecruitmentId" UUID,
    "imageId" UUID,
    "mentionIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "blockerId" UUID NOT NULL,
    "blockedId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "ChatImage" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "scope" VARCHAR(12) NOT NULL,
    "roomId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_postId_key" ON "Conversation"("postId");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_status_idx" ON "ConversationMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_imageId_key" ON "ConversationMessage"("imageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_senderId_createdAt_idx" ON "ConversationMessage"("conversationId", "senderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_seq_key" ON "ConversationMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_senderId_clientMessageId_key" ON "ConversationMessage"("conversationId", "senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "ChatImage_scope_roomId_createdAt_idx" ON "ChatImage"("scope", "roomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatImage_createdAt_idx" ON "ChatImage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatImage_authorId_requestKey_key" ON "ChatImage"("authorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_imageId_key" ON "ChatMessage"("imageId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ChatImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ChatImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatImage" ADD CONSTRAINT "ChatImage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
