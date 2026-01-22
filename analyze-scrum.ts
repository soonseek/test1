const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmknsr6100000bnrrc3wjymlg';

  const scrumExec = await prisma.agentExecution.findFirst({
    where: { projectId, agentId: 'scrum-master' },
    orderBy: { startedAt: 'desc' }
  });

  if (!scrumExec) {
    console.log('No Scrum Master execution found');
    await prisma.$disconnect();
    return;
  }

  console.log('=== Latest Scrum Master Execution ===');
  console.log('Status:', scrumExec.status);
  console.log('Started:', scrumExec.startedAt);
  console.log('');

  const output = scrumExec.output;
  console.log('=== Current Story ===');
  console.log(JSON.stringify(output.currentStory, null, 2));
  console.log('');

  console.log('=== Tasks ===');
  output.tasks.forEach((t, i) => {
    console.log(`[${i + 1}] ${t.id}: ${t.status}`);
  });
  console.log('');

  console.log('=== Summary ===');
  console.log(JSON.stringify(output.summary, null, 2));
  console.log('');

  // task 상태 통계
  const statusCount = {};
  output.tasks.forEach(t => {
    statusCount[t.status] = (statusCount[t.status] || 0) + 1;
  });
  console.log('=== Task Status Count ===');
  Object.entries(statusCount).forEach(([status, count]) => {
    console.log(`${status}: ${count}`);
  });

  await prisma.$disconnect();
}

main();
