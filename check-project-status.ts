import { prisma } from '@magic-wand/db';

async function checkProject() {
  const projectId = 'cmkjhyu990000krrr7jdknns9';

  // Project 조회
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      storyFiles: true,
    }
  });

  console.log('=== Project Info ===');
  console.log('Name:', project?.name);
  console.log('Story Files Count:', project?.storyFiles?.length || 0);

  // Agent Executions 조회
  const executions = await prisma.agentExecution.findMany({
    where: { projectId },
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      agentId: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      output: true,
    }
  });

  console.log('\n=== Recent Executions ===');
  executions.forEach(ex => {
    const output = ex.output as any;
    console.log(`[${ex.agentId}] ${ex.status}`);
    if (ex.agentId === 'scrum-master' && output) {
      console.log('  Current Phase:', output.currentPhase);
      console.log('  Tasks:', output.tasks?.length || 0);
      console.log('  Summary:', JSON.stringify(output.summary));
      console.log('  Current Epic:', output.currentEpic?.title);
      console.log('  Current Story:', output.currentStory?.title);

      if (output.tasks && output.tasks.length > 0) {
        console.log('  Task Statuses:');
        output.tasks.forEach((t: any) => {
          console.log(`    - ${t.id}: ${t.status}`);
        });
      }
    }
  });

  await prisma.$disconnect();
}

checkProject().catch(console.error);
