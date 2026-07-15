import prisma from './lib/prisma';
async function run() {
  try {
    const users = await prisma.user.findMany({ include: { role: true } });
    console.log("SUCCESS: Users and Roles:\n", JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("ERROR: Failed to query users:", e);
  }
}
run().finally(() => prisma.$disconnect());
