import { prisma } from './src/index';

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
    take: 200, // 더 많은 실행 가져오기
    select: {
      id: true,
      agentId: true,
      status: true,
      startedAt: true,
      completedAt: true,
      output: true,
    }
  });

  console.log('\n=== Recent Executions (Total: ' + executions.length + ') ===');
  const scrumMasterExecs = executions.filter(ex => ex.agentId === 'scrum-master');
  console.log('Scrum Master Executions: ' + scrumMasterExecs.length);
  console.log('Developer Executions: ' + executions.filter(ex => ex.agentId === 'developer').length);
  console.log('Code Reviewer Executions: ' + executions.filter(ex => ex.agentId === 'code-reviewer').length);
  console.log('Tester Executions: ' + executions.filter(ex => ex.agentId === 'tester').length);

  if (scrumMasterExecs.length > 0) {
    scrumMasterExecs.forEach(ex => {
      const output = ex.output as any;
      console.log(`\n[${ex.agentId}] ${ex.status} - ${ex.startedAt}`);
      if (output) {
        console.log('  Current Phase:', output.currentPhase);
        console.log('  Tasks:', output.tasks?.length || 0);
        console.log('  Summary:', JSON.stringify(output.summary));
        console.log('  Current Epic:', output.currentEpic?.title);
        console.log('  Current Story:', output.currentStory?.title);

        if (output.tasks && output.tasks.length > 0) {
          console.log('  Task Statuses:');
          output.tasks.forEach((t: any) => {
            console.log(`    - ${t.id}: ${t.status} (storyOrder: ${t.storyOrder})`);
          });
        }
      }
    });
  } else {
    console.log('\n!!! NO SCRUM MASTER EXECUTIONS FOUND !!!');
    console.log('This is the root cause of all issues!');
  }

  await prisma.$disconnect();
}

checkProject().catch(console.error);
