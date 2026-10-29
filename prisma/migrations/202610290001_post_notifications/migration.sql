CREATE TABLE "PostMute" (
  "userId" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostMute_pkey" PRIMARY KEY ("userId", "postId"),
  CONSTRAINT "PostMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PostMute_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "Notice" ADD COLUMN "postId" UUID, ADD COLUMN "commentId" UUID;
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Notice_postId_recipientId_idx" ON "Notice"("postId", "recipientId");
