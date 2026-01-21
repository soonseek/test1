const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: 'cmkly9k5c000a2wllaq0f6pzf' }
  });

  if (!project) {
    console.log('프로젝트를 찾을 수 없습니다: cmkly9k5c000a2wllaq0f6pzf');
    console.log('\n최근 프로젝트 목록:');
    const allProjects = await prisma.project.findMany({
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    allProjects.forEach(p => {
      console.log(`  - ${p.id}: ${p.name}`);
    });
    await prisma.$disconnect();
    return;
  }

  const executions = await prisma.agentExecution.findMany({
    where: {
      projectId: 'cmkly9k5c000a2wllaq0f6pzf'
    },
    orderBy: {
      startedAt: 'desc'
    },
    take: 50
  });

  console.log('=== Project:', project.name, '===');
  console.log('Total Executions:', executions.length, '\n');

  // Scrum Master executions만 보되, 전체 다 보기
  const scrumMasterExecs = executions.filter(e => e.agentId === 'scrum-master');

  console.log(`=== Scrum Master Executions: ${scrumMasterExecs.length} ===\n`);

  for (let i = 0; i < scrumMasterExecs.length; i++) {
    const exec = scrumMasterExecs[i];
    console.log(`[${i + 1}] ${exec.startedAt}`);
    console.log(`Status: ${exec.status}`);
    console.log(`ID: ${exec.id}`);

    if (exec.output) {
      if (exec.output.tasks && exec.output.tasks.length > 0) {
        const completed = exec.output.tasks.filter((t: any) => t.status === 'completed').length;
        const pending = exec.output.tasks.filter((t: any) => t.status === 'pending').length;
        const failed = exec.output.tasks.filter((t: any) => t.status === 'failed').length;
        console.log(`  Tasks: ${exec.output.tasks.length} total (완료: ${completed}, 대기: ${pending}, 실패: ${failed})`);
        exec.output.tasks.forEach((t: any) => {
          console.log(`    - ${t.id}: ${t.status} (${t.title})`);
        });
      }
      if (exec.output.currentStory) {
        console.log(`  Current Story: ${exec.output.currentStory.epicOrder}-${exec.output.currentStory.storyOrder} (${exec.output.currentStory.title})`);
      }
      if (exec.output.currentTask) {
        console.log(`  Current Task: ${exec.output.currentTask.id} (${exec.output.currentTask.title})`);
      }
      if (exec.output.summary) {
        console.log(`  Summary:`, JSON.stringify(exec.output.summary));
      }
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main();
