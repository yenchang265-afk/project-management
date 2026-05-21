import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("canary — database connectivity", () => {
  it("connects to the database", async () => {
    const result = await prisma.$queryRaw<[{ one: bigint }]>`SELECT 1 AS one`;
    const row = result[0];
    if (!row) throw new Error("Query returned no rows");
    expect(Number(row.one)).toBe(1);
  });

  it("User table exists and is queryable", async () => {
    const count = await prisma.user.count();
    expect(typeof count).toBe("number");
  });
});
