-- Phase 5a: Audit log surface.
--
-- Adds an append-only AuditEvent table for org-level audit (auth events,
-- project changes, role changes). Strictly additive — no changes to Issue,
-- Project, Sprint, or Notification tables. We deliberately do NOT add a
-- foreign key from AuditEvent.actorId → User.id so deleting a user preserves
-- their audit trail.

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_kind_at_idx" ON "AuditEvent"("kind", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_at_idx" ON "AuditEvent"("actorId", "at");
