BEGIN;

ALTER TABLE "Post" ADD COLUMN "category" "Category",
  ADD COLUMN "customTopic" VARCHAR(40), ALTER COLUMN "topicId" DROP NOT NULL;

UPDATE "Post" p SET "category" = t."category" FROM "Topic" t WHERE t."id" = p."topicId";

ALTER TABLE "Post" ALTER COLUMN "category" SET NOT NULL,
  ADD CONSTRAINT "Post_has_one_topic" CHECK (("topicId" IS NULL) <> ("customTopic" IS NULL));
CREATE INDEX "Post_schoolId_category_status_createdAt_id_idx" ON "Post"("schoolId", "category", "status", "createdAt", "id");

ALTER TABLE "Recruitment" ADD COLUMN "customTopic" VARCHAR(40),
  ADD CONSTRAINT "Recruitment_has_at_most_one_topic" CHECK ("topicId" IS NULL OR "customTopic" IS NULL);

ALTER TABLE "Profile" ADD COLUMN "avatarRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hasCustomAvatar" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProfileAvatar" (
  "profileId" UUID NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "bytes" BYTEA NOT NULL,
  CONSTRAINT "ProfileAvatar_pkey" PRIMARY KEY ("profileId"),
  CONSTRAINT "ProfileAvatar_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
