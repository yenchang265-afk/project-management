import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.warn("Seeding database...");

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { name: "Admin User" },
    create: {
      email: "admin@example.com",
      name: "Admin User",
    },
  });

  console.warn("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
