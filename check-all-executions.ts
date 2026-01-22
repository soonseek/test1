const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const executions = await prisma.agentExecution.findMany({
    where: { projectId: 'cmknm1qpw0002yn5ubomia63x' },
    orderBy: { startedAt: 'desc' },
    take: 30
  });

  console.log('=== ALL RECENT EXECUTIONS (latest 30) ===\n');

  executions.forEach((exec: any, i: number) => {
    console.log('[' + (i + 1) + '] ' + exec.agentId.toUpperCase());
    console.log('    Time: ' + exec.startedAt);
    console.log('    Status: ' + exec.status);
    console.log('    ID: ' + exec.id);

    if (exec.output) {
      if (exec.output.currentTask) {
        console.log('    Current Task: ' + exec.output.currentTask.id + ' - ' + exec.output.currentTask.title);
      }
      if (exec.output.currentStory) {
        console.log('    Current Story: ' + exec.output.currentStory.epicOrder + '-' + exec.output.currentStory.storyOrder);
      }
      if (exec.output.tasks && exec.agentId === 'scrum-master') {
        console.log('    Total Tasks: ' + exec.output.tasks.length);
      }
    }

    if (exec.error) {
      console.log('    Error: ' + exec.error.substring(0, 100));
    }

    console.log('');
  });

  await prisma.$disconnect();
}

main();
