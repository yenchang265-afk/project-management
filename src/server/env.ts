import { z } from "zod";

/* Validate required secrets at startup (project rule: fail fast, never log values).
   DATABASE_ADMIN_URL is only needed by migrate/seed scripts, so it is optional here. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^mysql:\/\/.+/, "DATABASE_URL must be a mysql:// URL"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  E2E_TEST: z.string().optional(), // "1" enables the test-only reset endpoint
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
