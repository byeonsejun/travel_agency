import { PrismaClient } from "@prisma/client";

async function main() {
  const db = new PrismaClient();
  const users = await db.user.findMany({
    select: { id: true, email: true, role: true, emailVerified: true },
  });
  console.log(JSON.stringify(users, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
