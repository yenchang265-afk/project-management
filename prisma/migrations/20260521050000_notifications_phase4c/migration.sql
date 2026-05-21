-- Phase 4c: Notifications (in-app + email) + IssueWatcher.
--
-- Strictly additive — no changes to Issue/Project/Sprint tables. The
-- IssueWatcher.issueId column is a foreign key in SQL but not declared as a
-- Prisma relation field, because adding the reverse relation would require
-- editing the Issue model (forbidden by the Phase 4c scope).

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM (
    'ISSUE_ASSIGNED',
    'ISSUE_MENTIONED',
    'ISSUE_COMMENTED',
    'ISSUE_TRANSITIONED',
    'ISSUE_CREATED_IN_WATCHED',
    'SPRINT_STARTED',
    'SPRINT_COMPLETED'
);

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueWatcher" (
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueWatcher_pkey" PRIMARY KEY ("issueId", "userId")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_kind_channel_key"
    ON "NotificationPreference"("userId", "kind", "channel");

-- CreateIndex
CREATE INDEX "IssueWatcher_userId_idx" ON "IssueWatcher"("userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueWatcher" ADD CONSTRAINT "IssueWatcher_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueWatcher" ADD CONSTRAINT "IssueWatcher_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
