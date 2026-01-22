const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const allExecs = await prisma.agentExecution.findMany({
    where: { projectId: 'cmknm1qpw0002yn5ubomia63x' },
    orderBy: { startedAt: 'asc' }
  });

  console.log('=== ALL EXECUTIONS IN CHRONOLOGICAL ORDER ===\n');

  allExecs.forEach((exec: any) => {
    if (exec.output && exec.output.currentTask) {
      console.log('[' + exec.startedAt + '] ' + exec.agentId.toUpperCase());
      console.log('  Task: ' + exec.output.currentTask.id);
      console.log('  Title: ' + exec.output.currentTask.title);
      console.log('');
    }
  });

  await prisma.$disconnect();
}

main();
