const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: 'cmknm1qpw0002yn5ubomia63x' }
  });

  if (!project) {
    console.log('프로젝트를 찾을 수 없습니다: cmknm1qpw0002yn5ubomia63x');
    await prisma.$disconnect();
    return;
  }

  const executions = await prisma.agentExecution.findMany({
    where: { projectId: 'cmknm1qpw0002yn5ubomia63x' },
    orderBy: { startedAt: 'desc' },
    take: 30
  });

  console.log('=== Project:', project.name, '===');
  console.log('Total Executions:', executions.length, '\n');

  // Group by agent
  const byAgent: Record<string, any[]> = {};
  executions.forEach(exec => {
    if (!byAgent[exec.agentId]) byAgent[exec.agentId] = [];
    byAgent[exec.agentId].push(exec);
  });

  for (const [agentId, execs] of Object.entries(byAgent)) {
    console.log('=== ' + agentId.toUpperCase() + ' Executions: ' + execs.length + ' ===\n');

    execs.slice(0, 5).forEach((exec: any, i: number) => {
      console.log('[' + (i + 1) + '] ' + exec.startedAt);
      console.log('Status: ' + exec.status);
      console.log('ID: ' + exec.id);

      if (exec.output) {
        if (exec.output.tasks) {
          console.log('  Tasks: ' + exec.output.tasks.length + ' total');
          exec.output.tasks.forEach((t: any) => {
            console.log('    - ' + t.id + ': ' + t.status + ' - ' + t.title);
          });
        }
        if (exec.output.currentStory) {
          console.log('  Current Story: ' + exec.output.currentStory.epicOrder + '-' + exec.output.currentStory.storyOrder);
        }
        if (exec.output.currentTask) {
          console.log('  Current Task: ' + exec.output.currentTask.id + ' - ' + exec.output.currentTask.title);
        }
        if (exec.output.summary) {
          console.log('  Summary: ' + JSON.stringify(exec.output.summary));
        }
      }

      if (exec.error) {
        console.log('  Error: ' + exec.error);
      }

      console.log('');
    });
  }

  await prisma.$disconnect();
}

main();
