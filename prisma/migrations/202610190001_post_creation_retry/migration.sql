-- Existing discussions keep NULL request metadata and remain unchanged.
ALTER TABLE "Post"
  ADD COLUMN "createRequestKey" UUID,
  ADD COLUMN "createRequestHash" CHAR(64);

CREATE UNIQUE INDEX "Post_authorId_createRequestKey_key" ON "Post"("authorId", "createRequestKey");
