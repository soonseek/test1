const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmknm1qpw0002yn5ubomia63x';

  console.log('=== 프로젝트 데이터 초기화 ===');
  console.log('Project ID:', projectId);
  console.log('');

  // 1. AgentExecution 삭제
  console.log('1. AgentExecution 삭제 중...');
  const executionsResult = await prisma.agentExecution.deleteMany({
    where: { projectId }
  });
  console.log(`   ✅ ${executionsResult.count}개의 AgentExecution 삭제 완료`);

  // 2. Deployment 삭제
  console.log('2. Deployment 삭제 중...');
  const deploymentResult = await prisma.deployment.deleteMany({
    where: { projectId }
  });
  console.log(`   ✅ ${deploymentResult.count}개의 Deployment 삭제 완료`);

  // 3. Project 자체 삭제
  console.log('3. Project 삭제 중...');
  const projectResult = await prisma.project.deleteMany({
    where: { id: projectId }
  });
  console.log(`   ✅ ${projectResult.count}개의 Project 삭제 완료`);

  console.log('');
  console.log('=== 초기화 완료 ===');
  console.log('이제 새로운 프로젝트를 처음부터 시작할 수 있습니다!');

  await prisma.$disconnect();
}

main();
