const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const executions = await prisma.agentExecution.findMany({
    where: { projectId: 'cmknm1qpw0002yn5ubomia63x' },
    orderBy: { startedAt: 'desc' },
    take: 15
  });

  console.log('=== LATEST 15 EXECUTIONS IN REVERSE ORDER ===\n');
  console.log('(Oldest → Newest)\n');

  // Reverse to show oldest first
  const reversed = [...executions].reverse();

  for (let i = 0; i < reversed.length; i++) {
    const exec = reversed[i] as any;
    console.log('[' + (i + 1) + '] ' + exec.agentId.toUpperCase());
    console.log('    Time: ' + exec.startedAt);
    console.log('    Status: ' + exec.status);

    if (exec.output) {
      if (exec.output.currentTask) {
        console.log('    Task: ' + exec.output.currentTask.id + ' - ' + exec.output.currentTask.title);
      }
      if (exec.output.currentStory) {
        console.log('    Story: ' + exec.output.currentStory.epicOrder + '-' + exec.output.currentStory.storyOrder);
      }
      if (exec.output.tasks && exec.agentId === 'scrum-master') {
        console.log('    Total Tasks: ' + exec.output.tasks.length);
        exec.output.tasks.forEach((t: any) => {
          console.log('      - ' + t.id + ': ' + t.status);
        });
      }
      if (exec.output.specsGenerated) {
        console.log('    Specs Generated: ' + exec.output.specsGenerated);
      }
    }

    if (exec.logs && exec.logs.length > 0) {
      const logs = exec.logs as any[];
      const lastLog = logs[logs.length - 1];
      if (lastLog && lastLog.message) {
        console.log('    Last Log: ' + lastLog.message.substring(0, 80));
      }
    }

    console.log('');
  }

  await prisma.$disconnect();
}

main();
