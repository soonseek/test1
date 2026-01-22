const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmknm1qpw0002yn5ubomia63x';

  // 1. 최근 Scrum Master 실행 확인 (최신 5개)
  const scrumExecs = await prisma.agentExecution.findMany({
    where: { projectId, agentId: 'scrum-master' },
    orderBy: { startedAt: 'desc' },
    take: 5
  });

  console.log('=== 최근 Scrum Master 실행 (최신순) ===\n');

  scrumExecs.forEach((exec: any, i: number) => {
    console.log(`[${i + 1}] ${exec.startedAt}`);
    console.log(`Status: ${exec.status}`);
    console.log(`ID: ${exec.id}`);

    if (exec.output) {
      const output = exec.output;
      if (output.currentStory) {
        console.log(`Current Story: ${output.currentStory.epicOrder}-${output.currentStory.storyOrder}`);
      }
      if (output.tasks && output.tasks.length > 0) {
        console.log(`Tasks: ${output.tasks.length}개`);
        output.tasks.forEach((t: any) => {
          console.log(`  - ${t.id}: ${t.status}`);
        });
      }
    }
    console.log('');
  });

  // 2. 각 Story별 최신 실행 확인
  console.log('\n=== 각 Story별 최신 Scrum Master 실행 ===\n');

  // 모든 Scrum Master 실행 가져오기
  const allScrumExecs = await prisma.agentExecution.findMany({
    where: { projectId, agentId: 'scrum-master' },
    orderBy: { startedAt: 'desc' }
  });

  // Story별로 그룹화
  const storyExecutions = new Map<string, any>();

  for (const exec of allScrumExecs) {
    if (exec.output && exec.output.currentStory) {
      const storyKey = `${exec.output.currentStory.epicOrder}-${exec.output.currentStory.storyOrder}`;
      // 처음 나오는 것이 최신 실행 (내림차순이므로)
      if (!storyExecutions.has(storyKey)) {
        storyExecutions.set(storyKey, exec);
      }
    }
  }

  // 각 Story별 상태 출력
  for (const [storyKey, exec] of storyExecutions) {
    const output = exec.output;
    console.log(`Story ${storyKey}:`);
    console.log(`  실행 시간: ${exec.startedAt}`);
    console.log(`  Tasks: ${output.tasks?.length || 0}개`);

    if (output.tasks && output.tasks.length > 0) {
      const completed = output.tasks.filter((t: any) => t.status === 'completed').length;
      const pending = output.tasks.filter((t: any) => t.status === 'pending').length;
      console.log(`    - completed: ${completed}`);
      console.log(`    - pending: ${pending}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main();
