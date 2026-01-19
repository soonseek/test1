import { prisma } from './packages/db/src/index';

async function checkDeveloperOutput() {
  const developerExec = await prisma.agentExecution.findFirst({
    where: {
      projectId: 'cmkjebnjp00008r2sebaps44b',
      agentId: 'developer',
      status: 'COMPLETED',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  if (!developerExec) {
    console.log('No completed Developer execution found');
    return;
  }

  console.log('\n=== Latest Developer Agent Output ===\n');
  console.log('Status:', developerExec.status);
  console.log('Started:', developerExec.startedAt);
  console.log('Completed:', developerExec.completedAt);

  if (developerExec.output) {
    console.log('\n--- Output ---');
    console.log(JSON.stringify(developerExec.output, null, 2));
  }

  const scrumMasterExec = await prisma.agentExecution.findFirst({
    where: {
      projectId: 'cmkjebnjp00008r2sebaps44b',
      agentId: 'scrum-master',
      status: 'COMPLETED',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  if (scrumMasterExec && scrumMasterExec.output) {
    console.log('\n=== Scrum Master Output ===\n');
    const output = scrumMasterExec.output as any;
    console.log('Current Epic:', output.currentEpic);
    console.log('Current Story:', output.currentStory);
    console.log('Total Tasks:', output.tasks?.length || 0);
    console.log('\n--- Tasks ---');
    output.tasks?.forEach((task: any, index: number) => {
      console.log(`${index + 1}. ${task.title} - Status: ${task.status}`);
    });
  }
}

checkDeveloperOutput()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
