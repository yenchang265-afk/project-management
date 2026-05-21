// Integration test setup
// DATABASE_URL must point to an isolated test database
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for integration tests");
}
