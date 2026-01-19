import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { prisma } from '@magic-wand/db';

interface CodeGeneratorInput {
  projectId: string;
  claudeCodePrompt: string;
  generationPlan: any;
  attachments: any[];
  githubRepoUrl: string;
}

interface CodeGeneratorOutput {
  generationResult: {
    status: 'success' | 'partial' | 'failed';
    filesCreated: string[];
    codeStructure: any;
    generationLogs: any[];
    warnings: any[];
  };
  codeQualityMetrics: {
    totalLines: number;
    testCoverage: number;
    eslintErrors: number;
    typeErrors: number;
  };
}

export class CodeGeneratorAgent extends Agent {
  private workspaceBase: string;

  constructor() {
    super({
      agentId: 'code-generator',
      name: '코드 생성기',
      role: 'Claude Code CLI를 실행하여 MVP 코드 생성',
      trigger: {
        type: 'dependency_satisfied',
        dependencies: ['prompt-builder'],
      },
      completionMode: CompletionMode.REQUIRES_REVIEW,
      maxRetries: 5,
      timeout: 7200, // 2시간
      dependencies: ['prompt-builder'],
      contextSharing: {
        sharesTo: ['github-pusher', 'e2e-test-runner', 'issue-resolver'],
        data: ['generated_code_structure', 'generation_logs', 'code_quality_metrics'],
      },
    });

    this.workspaceBase = process.env.CODE_WORKSPACE_BASE || path.join(process.cwd(), 'workspaces');
  }

  async execute(input: CodeGeneratorInput): Promise<AgentExecutionResult> {
    await this.log('코드 생성 시작', { projectId: input.projectId });

    const workspaceDir = path.join(this.workspaceBase, input.projectId);

    try {
      // 1. 작업 디렉토리 생성
      await fs.ensureDir(workspaceDir);

      // 2. Claude Code 실행
      const result = await this.executeClaudeCode(
        workspaceDir,
        input.claudeCodePrompt,
        input.attachments
      );

      // 3. 생성된 파일 분석
      const codeStructure = await this.analyzeGeneratedCode(workspaceDir);

      // 4. 코드 품질 메트릭 수집
      const codeQualityMetrics = await this.collectCodeQualityMetrics(workspaceDir);

      // 5. 검증
      const validationResult = await this.validateGeneration(workspaceDir, codeStructure);

      const output: CodeGeneratorOutput = {
        generationResult: {
          status: validationResult.success ? 'success' : validationResult.partial ? 'partial' : 'failed',
          filesCreated: codeStructure.files,
          codeStructure,
          generationLogs: result.logs,
          warnings: validationResult.warnings,
        },
        codeQualityMetrics,
      };

      // 6. 데이터베이스에 저장
      await this.saveResult(input.projectId, workspaceDir, output);

      await this.log('코드 생성 완료', {
        status: output.generationResult.status,
        filesCount: output.generationResult.filesCreated.length,
        totalLines: output.codeQualityMetrics.totalLines,
      });

      return {
        status: validationResult.success ? AgentStatus.COMPLETED : AgentStatus.FAILED,
        output,
        attachments: [
          {
            type: 'code_diff',
            url: `file://${workspaceDir}`,
            description: '생성된 코드',
          },
        ],
      };
    } catch (error: any) {
      await this.logError(error);

      // 실패 시에도 진행 상황 저장
      try {
        const codeStructure = await this.analyzeGeneratedCode(workspaceDir);
        await this.savePartialResult(input.projectId, workspaceDir, error, codeStructure);
      } catch (saveError) {
        await this.logError(saveError as Error);
      }

      return {
        status: AgentStatus.FAILED,
        error: {
          message: error.message,
          stackTrace: error.stack,
          retryable: this.isRetryable(error),
        },
      };
    }
  }

  private async executeClaudeCode(
    workspaceDir: string,
    prompt: string,
    attachments: any[]
  ): Promise<{ logs: any[] }> {
    const logs: any[] = [];
    const claudeCodePath = process.env.CLAUDE_CODE_PATH || 'npx claude-code';
    const skipPermissions = process.env.CLAUDE_CODE_SKIP_PERMISSIONS === 'true';

    const args = skipPermissions ? ['--dangerously-skip-permissions'] : [];

    // 프롬프트를 파일로 저장
    const promptFile = path.join(workspaceDir, 'prompt.txt');
    await fs.writeFile(promptFile, prompt);

    logs.push({
      timestamp: new Date().toISOString(),
      message: 'Claude Code 실행 시작',
      workspace: workspaceDir,
    });

    try {
      const subprocess = execa(claudeCodePath, args, {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'development',
        },
      });

      // 프롬프트 입력
      if (subprocess.stdin) {
        subprocess.stdin.write(prompt);
        subprocess.stdin.end();
      }

      // 출력 수집
      subprocess.stdout?.on('data', (data) => {
        const message = data.toString();
        logs.push({
          timestamp: new Date().toISOString(),
          type: 'stdout',
          message: message.substring(0, 500), // 로그 사이즈 제한
        });
      });

      subprocess.stderr?.on('data', (data) => {
        const message = data.toString();
        logs.push({
          timestamp: new Date().toISOString(),
          type: 'stderr',
          message: message.substring(0, 500),
        });
      });

      await subprocess;

      logs.push({
        timestamp: new Date().toISOString(),
        message: 'Claude Code 실행 완료',
        exitCode: subprocess.exitCode,
      });
    } catch (error: any) {
      logs.push({
        timestamp: new Date().toISOString(),
        type: 'error',
        message: `Claude Code 실행 실패: ${error.message}`,
      });
      throw error;
    }

    return { logs };
  }

  private async analyzeGeneratedCode(workspaceDir: string): Promise<any> {
    const files: string[] = [];
    let totalLines = 0;

    const walkDir = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // node_modules, .next 등 제외
          if (
            !entry.name.startsWith('.') &&
            entry.name !== 'node_modules' &&
            entry.name !== 'dist' &&
            entry.name !== 'build'
          ) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.prisma'].includes(ext)) {
            files.push(fullPath);
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              totalLines += content.split('\n').length;
            } catch (error) {
              // 파일 읽기 실패 무시
            }
          }
        }
      }
    };

    await walkDir(workspaceDir);

    // 디렉토리 구조 분석
    const structure = this.buildDirectoryStructure(workspaceDir);

    return {
      files,
      totalFiles: files.length,
      totalLines,
      structure,
    };
  }

  private buildDirectoryStructure(dir: string, basePath = dir): any {
    const structure: any = { name: path.basename(dir), children: [] };

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          structure.children.push(
            this.buildDirectoryStructure(path.join(dir, entry.name), basePath)
          );
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.json', '.prisma'].includes(ext)) {
            structure.children.push({
              name: entry.name,
              type: 'file',
            });
          }
        }
      }
    } catch (error) {
      // 디렉토리 읽기 실패 무시
    }

    return structure;
  }

  private async collectCodeQualityMetrics(workspaceDir: string): Promise<any> {
    return {
      totalLines: 0,
      testCoverage: 0,
      eslintErrors: 0,
      typeErrors: 0,
      // 실제로는 ESLint, TypeScript 등 실행
    };
  }

  private async validateGeneration(workspaceDir: string, codeStructure: any): Promise<{
    success: boolean;
    partial: boolean;
    warnings: any[];
  }> {
    const warnings: any[] = [];
    let success = true;
    let partial = false;

    // 필수 파일/디렉토리 확인
    const requiredPaths = [
      'package.json',
      'next.config.js',
      'tsconfig.json',
      'src/app',
      'src/app/page.tsx',
      'src/app/layout.tsx',
    ];

    for (const requiredPath of requiredPaths) {
      const fullPath = path.join(workspaceDir, requiredPath);
      const exists = await fs.pathExists(fullPath);
      if (!exists) {
        warnings.push({
          type: 'missing',
          path: requiredPath,
          message: `필수 파일/디렉토리가 없습니다: ${requiredPath}`,
        });
        partial = true;
      }
    }

    // package.json 확인
    const packageJsonPath = path.join(workspaceDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const packageJson = await fs.readJson(packageJsonPath);
        if (!packageJson.dependencies?.next) {
          warnings.push({
            type: 'dependency',
            message: 'Next.js가 설치되지 않았습니다',
          });
          success = false;
        }
      } catch (error) {
        warnings.push({
          type: 'parse',
          message: 'package.json을 파싱할 수 없습니다',
        });
        success = false;
      }
    }

    if (warnings.length > 5) {
      success = false;
    }

    return { success, partial, warnings };
  }

  private async saveResult(projectId: string, workspaceDir: string, output: CodeGeneratorOutput): Promise<void> {
    await prisma.agentExecution.create({
      data: {
        projectId,
        agentId: this.getId(),
        agentName: this.getName(),
        status: 'COMPLETED',
        input: {},
        output: {
          workspaceDir,
          status: output.generationResult.status,
          filesCount: output.generationResult.filesCreated.length,
        },
      },
    });
  }

  private async savePartialResult(
    projectId: string,
    workspaceDir: string,
    error: any,
    codeStructure: any
  ): Promise<void> {
    await prisma.agentExecution.create({
      data: {
        projectId,
        agentId: this.getId(),
        agentName: this.getName(),
        status: 'FAILED',
        input: {},
        output: {
          workspaceDir,
          partial: true,
          filesCount: codeStructure.files?.length || 0,
        },
        error: {
          message: error.message,
          stackTrace: error.stack,
          retryable: this.isRetryable(error),
        },
      },
    });
  }
}
