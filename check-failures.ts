import { prisma } from '@magic-wand/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

async function analyzeFailures() {
  const projectId = 'cmkjhyu990000krrr7jdknns9';

  console.log('=== Analyzing Agent Executions ===\n');

  // Get all agent executions for this project
  const executions = await prisma.agentExecution.findMany({
    where: { projectId },
    orderBy: { startedAt: 'desc' },
  });

  console.log(`Total executions: ${executions.length}\n`);

  // Group by agent
  const byAgent: Record<string, any[]> = {};
  executions.forEach((ex: any) => {
    if (!byAgent[ex.agentId]) byAgent[ex.agentId] = [];
    byAgent[ex.agentId].push(ex);
  });

  // Analyze Developer executions
  const developerExecs = byAgent['developer'] || [];
  console.log(`\n=== Developer Executions: ${developerExecs.length} ===`);

  for (const exec of developerExecs) {
    const output = exec.output as any;
    console.log(`\n[${exec.id}] Status: ${exec.status}`);
    console.log(`Started: ${exec.startedAt}`);
    console.log(`Completed: ${exec.finishedAt}`);

    if (output) {
      console.log(`Files Created: ${output.summary?.filesCreated || 0}`);
      console.log(`Files Modified: ${output.summary?.filesModified || 0}`);
      console.log(`Current Task: ${output.currentTask?.id || 'N/A'}`);

      if (output.error) {
        console.log(`ERROR: ${output.error.message}`);
      }
    }

    // Check logs if available
    const logPath = join(process.cwd(), '.logs', `${exec.id}.log`);
    if (existsSync(logPath)) {
      const logs = readFileSync(logPath, 'utf-8');
      console.log(`\n--- Last 500 chars of logs ---`);
      console.log(logs.slice(-500));
    }
  }

  // Analyze CodeReviewer executions
  const reviewerExecs = byAgent['code-reviewer'] || [];
  console.log(`\n\n=== Code Reviewer Executions: ${reviewerExecs.length} ===`);

  for (const exec of reviewerExecs) {
    const output = exec.output as any;
    console.log(`\n[${exec.id}] Status: ${exec.status}`);

    if (output) {
      console.log(`Review Result: ${output.reviewResult || 'N/A'}`);
      console.log(`Score: ${output.overallScore || 'N/A'}`);
      console.log(`Issues: ${output.summary?.totalIssues || 0}`);
      console.log(`High Severity: ${output.summary?.highSeverity || 0}`);
      console.log(`Medium Severity: ${output.summary?.mediumSeverity || 0}`);

      if (output.failures && output.failures.length > 0) {
        console.log('\nFailures:');
        output.failures.slice(0, 3).forEach((f: any, i: number) => {
          console.log(`  ${i + 1}. [${f.severity}] ${f.category}: ${f.issue}`);
        });
      }
    }
  }

  // Get Scrum Master tasks
  const smExec = byAgent['scrum-master']?.[0];
  if (smExec && smExec.output) {
    const tasks = (smExec.output as any).tasks || [];
    console.log(`\n\n=== Task Status Summary ===`);
    console.log(`Total Tasks: ${tasks.length}`);
    console.log(`Completed: ${tasks.filter((t: any) => t.status === 'completed').length}`);
    console.log(`Failed: ${tasks.filter((t: any) => t.status === 'failed').length}`);
    console.log(`Pending: ${tasks.filter((t: any) => t.status === 'pending').length}`);

    console.log('\n\nFailed Tasks:');
    tasks.filter((t: any) => t.status === 'failed').forEach((t: any) => {
      console.log(`  - ${t.id}: ${t.title}`);
      console.log(`    Retry Count: ${t.retryCount || 0}`);
    });
  }
}

analyzeFailures()
  .then(() => console.log('\n\nDone'))
  .catch((err) => console.error('Error:', err))
  .finally(() => prisma.$disconnect());
