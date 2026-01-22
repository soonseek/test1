const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmknm1qpw0002yn5ubomia63x';

  // 수정된 로직 시뮬레이션
  console.log('=== 수정된 로직 테스트 ===\n');

  // 1. 이전 실행 가져오기 (내림차순)
  const previousExecution = await prisma.agentExecution.findMany({
    where: {
      projectId,
      agentId: { in: ['scrum-master', 'developer', 'code-reviewer', 'tester'] },
    },
    orderBy: {
      startedAt: 'desc',
    },
    take: 30,
  });

  console.log(`총 ${previousExecution.length}개의 실행 가져옴\n`);

  // 2. 각 story별로 모든 실행에서 완료된 태스크 누적 계산
  const storyTaskTracking = new Map();

  for (const exec of previousExecution) {
    if (exec.agentId === 'scrum-master' && exec.status === 'COMPLETED') {
      const output = exec.output;
      if (output && output.currentStory && output.tasks && output.tasks.length > 0) {
        const storyKey = `${output.currentStory.epicOrder}-${output.currentStory.storyOrder}`;

        if (!storyTaskTracking.has(storyKey)) {
          storyTaskTracking.set(storyKey, {
            totalTasks: output.tasks.length,
            completedTaskIds: new Set(),
            storyKey,
          });
        }

        const tracking = storyTaskTracking.get(storyKey);
        output.tasks.forEach((task) => {
          if (task.status === 'completed') {
            tracking.completedTaskIds.add(task.id);
          }
        });

        console.log(`Story 실행 결과 처리: ${storyKey}`);
        console.log(`  실행 시간: ${exec.startedAt}`);
        console.log(`  총 태스크: ${output.tasks.length}`);
        console.log(`  이 실행에서 완료된 태스크: ${output.tasks.filter(t => t.status === 'completed').length}`);
        console.log(`  누적 완료 태스크: ${tracking.completedTaskIds.size}`);
        console.log('');
      }
    }
  }

  // 3. 각 story별 완료 상태 확인
  console.log('=== 각 Story별 최종 완료 현황 ===\n');

  for (const [storyKey, tracking] of storyTaskTracking) {
    const completedCount = tracking.completedTaskIds.size;
    const totalCount = tracking.totalTasks;
    const isComplete = completedCount >= totalCount && totalCount > 0;

    console.log(`Story ${storyKey}:`);
    console.log(`  총 태스크: ${totalCount}`);
    console.log(`  완료된 태스크: ${completedCount}`);
    console.log(`  완료된 태스크 ID: [${Array.from(tracking.completedTaskIds).join(', ')}]`);
    console.log(`  완료 여부: ${isComplete ? '✅ 완료' : '⏳ 진행 중'}`);
    console.log('');
  }

  // 4. 완료된 Story 목록
  const completedStories = new Set();
  for (const [storyKey, tracking] of storyTaskTracking) {
    const completedCount = tracking.completedTaskIds.size;
    const totalCount = tracking.totalTasks;
    if (completedCount >= totalCount && totalCount > 0) {
      completedStories.add(storyKey);
    }
  }

  console.log(`=== 완료된 Story 목록: ${Array.from(completedStories).join(', ')} ===\n`);

  // 5. 다음 Story 예상
  if (completedStories.has('1-1')) {
    console.log('✅ Story 1-1이 완료된 것으로 판단 → Story 1-2로 이동해야 합니다\n');
  } else {
    console.log('⏳ Story 1-1이 완료되지 않은 것으로 판단 → Story 1-1을 다시 실행합니다\n');
  }

  await prisma.$disconnect();
}

main();
