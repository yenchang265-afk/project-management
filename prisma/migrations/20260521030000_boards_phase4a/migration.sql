-- Phase 4a: Boards / Backlog / Search / Saved Filters

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedFilter_userId_idx" ON "SavedFilter"("userId");

-- CreateIndex
CREATE INDEX "SavedFilter_projectId_idx" ON "SavedFilter"("projectId");

-- Full-text search column on Issue. We don't model this in schema.prisma
-- because Prisma doesn't support tsvector — the search service reads it via
-- $queryRaw.
ALTER TABLE "Issue"
    ADD COLUMN "search_tsv" tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", ''))
    ) STORED;

CREATE INDEX "issue_search_idx" ON "Issue" USING GIN ("search_tsv");
