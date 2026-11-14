ALTER TABLE "Recruitment"
  DROP CONSTRAINT "Recruitment_published_fields_check",
  ADD CONSTRAINT "Recruitment_published_fields_check" CHECK (
    "publicationStatus" = 'DRAFT' OR (
      "publishedAt" IS NOT NULL AND ("topicId" IS NOT NULL OR "customTopic" IS NOT NULL) AND "joinDeadline" IS NOT NULL AND (
        (
          COALESCE("payload" #>> '{plan,schedule}', '') IN ('FLEXIBLE', 'RECURRING')
          AND "startAt" IS NULL AND "endAt" IS NULL
        ) OR (
          "startAt" IS NOT NULL AND "joinDeadline" <= "startAt"
          AND (
            ("endAt" IS NOT NULL AND "startAt" < "endAt") OR
            ("endAt" IS NULL AND COALESCE("payload" #>> '{plan,schedule}', '') = 'FIXED')
          )
        )
      )
    )
  );
