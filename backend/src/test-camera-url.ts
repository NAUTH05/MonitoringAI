import prisma from './lib/prisma';
async function main() {
  const cam = await prisma.camera.findFirst();
  if (cam) {
    await prisma.camera.update({ where: { id: cam.id }, data: { rtspUrl: 'https://www.w3schools.com/html/mov_bbb.mp4' }});
    console.log('Updated camera', cam.name, 'to MP4 test URL');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
