const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmknm1qpw0002yn5ubomia63x';

  // 모든 Scrum Master 실행 가져오기
  const allScrumExecs = await prisma.agentExecution.findMany({
    where: { projectId, agentId: 'scrum-master' },
    orderBy: { startedAt: 'desc' }
  });

  console.log(`=== 모든 Scrum Master 실행 (총 ${allScrumExecs.length}개) ===\n`);

  allScrumExecs.forEach((exec, i) => {
    console.log(`[${i + 1}] ${exec.startedAt}`);
    console.log(`ID: ${exec.id}`);
    if (exec.output && exec.output.tasks) {
      console.log(`Tasks: ${exec.output.tasks.length}개`);
      exec.output.tasks.forEach((task) => {
        console.log(`  - ${task.id}: ${task.status}`);
      });
    }
    console.log('');
  });

  await prisma.$disconnect();
}

main();
