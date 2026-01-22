const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  // 1. 최근 프로젝트 확인
  const recentProjects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, name: true, createdAt: true }
  });

  console.log('=== 최근 프로젝트 ===');
  recentProjects.forEach((p, i) => {
    console.log(`[${i + 1}] ${p.name} (${p.id}) - ${p.createdAt}`);
  });

  // 가장 최근 프로젝트 선택
  const project = await prisma.project.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  if (!project) {
    console.log('프로젝트를 찾을 수 없습니다');
    await prisma.$disconnect();
    return;
  }

  console.log('\n=== 현재 프로젝트 ===');
  console.log('이름:', project.name);
  console.log('ID:', project.id);
  console.log('생성일:', project.createdAt);

  // 2. Scrum Master 실행 확인
  const scrumExecs = await prisma.agentExecution.findMany({
    where: { projectId: project.id, agentId: 'scrum-master' },
    orderBy: { startedAt: 'desc' },
    take: 2
  });

  console.log('\n=== Scrum Master 실행 ===');
  scrumExecs.forEach((exec: any, i: number) => {
    console.log(`\n[${i + 1}] ${exec.startedAt}`);
    console.log('Status:', exec.status);
    console.log('ID:', exec.id);

    if (exec.output) {
      const output = exec.output;
      if (output.tasks) {
        console.log('\nTasks (' + output.tasks.length + ' total):');
        output.tasks.forEach((t: any) => {
          console.log(`  - ${t.id}: ${t.status} - ${t.title}`);
        });
      }
      if (output.currentStory) {
        console.log('\nCurrent Story:', output.currentStory.epicOrder + '-' + output.currentStory.storyOrder, output.currentStory.title);
      }
      if (output.currentPhase) {
        console.log('Current Phase:', output.currentPhase);
      }
      if (output.summary) {
        console.log('Summary:', JSON.stringify(output.summary));
      }
    }
  });

  // 3. 최근 전체 실행 확인 (최근 15개)
  const recentExecs = await prisma.agentExecution.findMany({
    where: { projectId: project.id },
    orderBy: { startedAt: 'desc' },
    take: 15
  });

  console.log('\n=== 최근 실행 (최신 15개) ===\n');
  recentExecs.reverse().forEach((exec: any, i: number) => {
    console.log(`[${i + 1}] ${exec.agentId.toUpperCase()} - ${exec.startedAt}`);
    console.log(`    Status: ${exec.status}`);
    if (exec.output && exec.output.currentTask) {
      console.log(`    Task: ${exec.output.currentTask.id} - ${exec.output.currentTask.title}`);
    }
  });

  await prisma.$disconnect();
}

main();
