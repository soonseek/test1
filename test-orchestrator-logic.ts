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

  const tasks = scrumExec.output.tasks;

  console.log('=== Orchestrator Logic Simulation ===\n');

  // pending Tasks
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  console.log(`1. Pending Tasks: ${pendingTasks.length}`);

  // inProgressTasks (developing, reviewing, testing)
  const inProgressTasks = tasks.filter(t => ['developing', 'reviewing', 'testing'].includes(t.status));
  console.log(`2. In-Progress Tasks: ${inProgressTasks.length}`);
  inProgressTasks.forEach(t => {
    console.log(`   - ${t.id}: ${t.status}`);
  });

  // completed Tasks
  const completedTasks = tasks.filter(t => t.status === 'completed');
  console.log(`3. Completed Tasks: ${completedTasks.length}`);

  console.log('\n=== Orchestrator Decision ===\n');
  console.log(`pendingTasks.length === 0: ${pendingTasks.length === 0}`);
  console.log(`inProgressTasks.length === 0: ${inProgressTasks.length === 0}`);
  console.log(`Both conditions met: ${pendingTasks.length === 0 && inProgressTasks.length === 0}`);

  if (pendingTasks.length === 0 && inProgressTasks.length === 0) {
    console.log('\n✅ Orchestrator would run Scrum Master again to get next story');
  } else if (inProgressTasks.length > 0) {
    console.log('\n⚠️ Orchestrator would recover in-progress task to pending');
    console.log(`   Task ${inProgressTasks[0].id} (${inProgressTasks[0].status}) → pending`);
  } else {
    console.log('\n⏳ Orchestrator would continue processing pending tasks');
  }

  console.log('\n=== Story Completion Check ===\n');
  const totalTasks = tasks.length;
  const completedCount = completedTasks.length;
  const isComplete = completedCount >= totalTasks && totalTasks > 0;

  console.log(`Total Tasks: ${totalTasks}`);
  console.log(`Completed Tasks: ${completedCount}`);
  console.log(`Story Complete: ${isComplete ? 'YES' : 'NO'}`);

  if (!isComplete) {
    console.log('\n❌ Story NOT complete - Scrum Master will generate NEW tasks for same story!');
    console.log('   This is the bug: testing task blocks story completion');
  }

  await prisma.$disconnect();
}

main();
