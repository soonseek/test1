const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const scrumExecs = await prisma.agentExecution.findMany({
    where: {
      projectId: 'cmknm1qpw0002yn5ubomia63x',
      agentId: 'scrum-master'
    },
    orderBy: { startedAt: 'desc' }
  });

  console.log('=== ALL SCRUM MASTER EXECUTIONS ===\n');
  console.log('Total: ' + scrumExecs.length + '\n');

  scrumExecs.forEach((exec: any, i: number) => {
    console.log('[' + (i + 1) + '] ' + exec.startedAt);
    console.log('Status: ' + exec.status);
    console.log('ID: ' + exec.id);

    if (exec.output) {
      if (exec.output.tasks) {
        console.log('Tasks: ' + exec.output.tasks.length + ' total');
        exec.output.tasks.forEach((t: any) => {
          console.log('  - ' + t.id + ': ' + t.status + ' - ' + t.title);
        });
      }
      if (exec.output.currentStory) {
        console.log('Current Story: ' + exec.output.currentStory.epicOrder + '-' + exec.output.currentStory.storyOrder);
      }
    }

    if (exec.logs && exec.logs.length > 0) {
      console.log('Logs (' + exec.logs.length + ' messages)');
    }

    console.log('');
  });

  await prisma.$disconnect();
}

main();
