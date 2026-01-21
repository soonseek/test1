const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const executions = await prisma.agentExecution.findMany({
    where: {
      projectId: 'cmkly9k5c000a2wllaq0f6pzf',
      agentId: 'scrum-master'
    },
    orderBy: {
      startedAt: 'desc'
    },
    take: 3
  });

  console.log('=== Latest Scrum Master Executions ===\n');

  for (const exec of executions) {
    console.log(`ID: ${exec.id}`);
    console.log(`Started: ${exec.startedAt}`);
    console.log(`Status: ${exec.status}`);
    console.log(`Error: ${exec.error || 'None'}`);

    if (exec.output) {
      console.log('\n--- Output ---');
      console.log(JSON.stringify(exec.output, null, 2));
    }

    if (exec.error) {
      console.log('\n--- Error Detail ---');
      if (typeof exec.error === 'object') {
        console.log(JSON.stringify(exec.error, null, 2));
      } else {
        console.log(exec.error);
      }
    }

    if (exec.logs && exec.logs.length > 0) {
      console.log('\n--- Logs (last 20) ---');
      const recentLogs = exec.logs.slice(-20);
      recentLogs.forEach(log => {
        console.log(`[${log.timestamp}] ${log.level}: ${log.message}`);
      });
    }

    console.log('\n' + '='.repeat(80) + '\n');
  }

  await prisma.$disconnect();
}

main();
