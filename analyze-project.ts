const { PrismaClient } = require('./packages/db/dist/index.js');
const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: 'cmknm1qpw0002yn5ubomia63x' }
  });

  if (!project) {
    console.log('Project not found');
    await prisma.$disconnect();
    return;
  }

  console.log('=== PROJECT INFO ===');
  console.log('Name:', project.name);
  console.log('ID:', project.id);

  const executions = await prisma.agentExecution.findMany({
    where: { projectId: project.id },
    orderBy: { startedAt: 'desc' },
    take: 50
  });

  console.log('\nTotal executions:', executions.length);

  const scrumExecs = executions.filter(e => e.agentId === 'scrum-master');
  console.log('Scrum Master executions:', scrumExecs.length);

  console.log('\n=== SCRUM MASTER HISTORY ===\n');

  scrumExecs.forEach((exec: any, i: number) => {
    console.log('[' + (i + 1) + '] ' + exec.startedAt);
    console.log('Status: ' + exec.status);
    console.log('ID: ' + exec.id);

    if (exec.output) {
      const output = exec.output;

      if (output.tasks && output.tasks.length > 0) {
        console.log('Tasks: ' + output.tasks.length + ' total');

        // Group by story
        const byStory: Record<string, any[]> = {};
        output.tasks.forEach((t: any) => {
          const key = t.epicOrder + '-' + t.storyOrder;
          if (!byStory[key]) byStory[key] = [];
          byStory[key].push(t);
        });

        Object.entries(byStory).sort().forEach(([key, tasks]) => {
          const completed = tasks.filter((t: any) => t.status === 'completed').length;
          const developing = tasks.filter((t: any) => t.status === 'developing').length;
          const reviewing = tasks.filter((t: any) => t.status === 'reviewing').length;
          const testing = tasks.filter((t: any) => t.status === 'testing').length;
          const pending = tasks.filter((t: any) => t.status === 'pending').length;
          console.log('  Story ' + key + ': ' + tasks.length + ' tasks (completed: ' + completed + ', developing: ' + developing + ', reviewing: ' + reviewing + ', testing: ' + testing + ', pending: ' + pending + ')');
        });
      } else {
        console.log('Tasks: 0');
      }

      if (output.currentStory) {
        console.log('Current Story: ' + output.currentStory.epicOrder + '-' + output.currentStory.storyOrder + ' - ' + output.currentStory.title);
      }

      if (output.currentTask) {
        console.log('Current Task: ' + output.currentTask.id + ' - ' + output.currentTask.title);
      }

      if (output.summary) {
        console.log('Summary:', JSON.stringify(output.summary));
      }
    }

    if (exec.error) {
      console.log('Error:', exec.error);
    }

    console.log('');
  });

  await prisma.$disconnect();
}

main();
