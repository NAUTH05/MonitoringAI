import prisma from './lib/prisma';
async function test() {
  try {
    const roles = await prisma.role.findMany();
    console.log("SUCCESS: Roles found in DB:", roles);
  } catch (err) {
    console.error("ERROR: Database connection failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}
test();
