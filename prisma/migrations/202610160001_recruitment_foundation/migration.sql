-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('CAPTAIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- CreateTable
CREATE TABLE "Recruitment" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "topicId" UUID,
    "sourcePostId" UUID,
    "category" "Category" NOT NULL DEFAULT 'COMPETITION',
    "title" VARCHAR(60) NOT NULL DEFAULT '',
    "description" VARCHAR(3000) NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createRequestKey" UUID NOT NULL,
    "createRequestHash" CHAR(64) NOT NULL,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "joinDeadline" TIMESTAMPTZ(3),
    "capacity" INTEGER NOT NULL,
    "allowCrossSchool" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Recruitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "recruitmentId" UUID NOT NULL,
    "captainUserId" UUID NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSlot" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL,

    CONSTRAINT "TeamSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSpace" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID,
    "kind" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recruitment_schoolId_publicationStatus_publishedAt_id_idx" ON "Recruitment"("schoolId", "publicationStatus", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "Recruitment_topicId_publicationStatus_idx" ON "Recruitment"("topicId", "publicationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Recruitment_authorId_createRequestKey_key" ON "Recruitment"("authorId", "createRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Team_recruitmentId_key" ON "Team"("recruitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSlot_id_teamId_key" ON "TeamSlot"("id", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSlot_teamId_position_key" ON "TeamSlot"("teamId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSpace_teamId_key" ON "ChatSpace"("teamId");

-- AddForeignKey
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_recruitmentId_fkey" FOREIGN KEY ("recruitmentId") REFERENCES "Recruitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_captainUserId_fkey" FOREIGN KEY ("captainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSlot" ADD CONSTRAINT "TeamSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_slotId_teamId_fkey" FOREIGN KEY ("slotId", "teamId") REFERENCES "TeamSlot"("id", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSpace" ADD CONSTRAINT "ChatSpace_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Additional invariants not expressible in the Prisma datamodel.
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_capacity_check" CHECK ("capacity" BETWEEN 2 AND 20);
ALTER TABLE "Recruitment" ADD CONSTRAINT "Recruitment_published_fields_check" CHECK (
  "publicationStatus" = 'DRAFT' OR (
    "publishedAt" IS NOT NULL AND "topicId" IS NOT NULL AND
    "startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "joinDeadline" IS NOT NULL AND
    "startAt" < "endAt" AND "joinDeadline" <= "startAt"
  )
);
ALTER TABLE "TeamSlot" ADD CONSTRAINT "TeamSlot_capacity_check" CHECK ("capacity" BETWEEN 1 AND 20);
CREATE UNIQUE INDEX "TeamMember_one_active_captain" ON "TeamMember"("teamId") WHERE "role" = 'CAPTAIN' AND "status" = 'ACTIVE';
