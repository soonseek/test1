import { prisma } from './packages/db/src/index';

async function checkAgents() {
  const executions = await prisma.agentExecution.findMany({
    where: {
      projectId: 'cmkjebnjp00008r2sebaps44b',
    },
    orderBy: {
      startedAt: 'desc',
    },
    take: 15,
  });

  console.log('\n=== Agent Executions for Project: cmkjebnjp00008r2sebaps44b ===\n');

  executions.forEach((exec, index) => {
    console.log(`${index + 1}. ${exec.agentId} (${exec.agentName})`);
    console.log(`   Status: ${exec.status}`);
    console.log(`   Started: ${exec.startedAt}`);
    console.log(`   Completed: ${exec.completedAt || 'N/A'}`);
    if (exec.error) {
      console.log(`   Error: ${exec.error.message || 'No error message'}`);
    }
    console.log('');
  });
}

checkAgents()
  .then(() => {
    console.log('\n=== Check Complete ===\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
