-- Phase 5b: In-Postgres rate-limit bucket store.
--
-- Single table keyed by an opaque string (e.g. `auth:ip:1.2.3.4` or
-- `write:user:abc123`). The service uses SELECT ... FOR UPDATE inside a
-- transaction to refresh tokens and decrement atomically. No FKs — keys are
-- transient and can be deleted independently of any user/project lifecycle.

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "lastRefill" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
