import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { WizardLevel } from '@magic-wand/shared';
import { prisma } from '@magic-wand/db';

interface PromptBuilderInput {
  projectId: string;
  structuredRequirements: any;
  parsedDocuments: any[];
  complexityScore: number;
  wizardLevel: WizardLevel;
}

interface PromptBuilderOutput {
  claudeCodePrompt: string;
  generationPlan: {
    phases: any[];
    estimatedSteps: number;
    riskFactors: string[];
  };
  attachments: Array<{
    type: string;
    url: string;
    description: string;
  }>;
}

export class PromptBuilderAgent extends Agent {
  constructor() {
    super({
      agentId: 'prompt-builder',
      name: '프롬프트 빌더',
      role: '요구사항과 파싱된 문서를 Claude Code 프롬프트로 변환',
      trigger: {
        type: 'dependency_satisfied',
        dependencies: ['requirement-analyzer', 'document-parser'],
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 2,
      timeout: 180, // 3분
      dependencies: ['requirement-analyzer', 'document-parser'],
      contextSharing: {
        sharesTo: ['code-generator'],
        data: ['claude_code_prompt', 'generation_plan'],
      },
    });
  }

  async execute(input: PromptBuilderInput): Promise<AgentExecutionResult> {
    await this.log('프롬프트 빌드 시작', { projectId: input.projectId });

    try {
      // 1. 프로젝트 정보 수집
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        include: {
          sessionFiles: true,
          surveyAnswer: true,
          deployment: true,
        },
      });

      if (!project) {
        throw new Error('프로젝트를 찾을 수 없습니다');
      }

      // 2. GitHub URL 확인
      if (!project.deployment?.githubRepoUrl) {
        throw new Error('GitHub 레포지토리 URL이 설정되지 않았습니다');
      }

      // 3. Claude Code 프롬프트 생성
      const claudeCodePrompt = this.buildPrompt(
        project,
        input.structuredRequirements,
        input.parsedDocuments,
        input.wizardLevel
      );

      // 4. 생성 계획 수립
      const generationPlan = this.createGenerationPlan(input.complexityScore, input.wizardLevel);

      // 5. 첨부파일 목록
      const attachments = this.buildAttachments(project.sessionFiles);

      // 6. 데이터베이스에 저장
      await this.savePrompt(input.projectId, claudeCodePrompt, generationPlan);

      const output: PromptBuilderOutput = {
        claudeCodePrompt,
        generationPlan,
        attachments,
      };

      await this.log('프롬프트 빌드 완료', {
        promptLength: claudeCodePrompt.length,
        estimatedSteps: generationPlan.estimatedSteps,
      });

      return {
        status: AgentStatus.COMPLETED,
        output,
      };
    } catch (error: any) {
      await this.logError(error);
      return {
        status: AgentStatus.FAILED,
        error: {
          message: error.message,
          stackTrace: error.stack,
          retryable: false,
        },
      };
    }
  }

  private buildPrompt(
    project: any,
    requirements: any,
    documents: any[],
    wizardLevel: WizardLevel
  ): string {
    let prompt = this.getTemplate(wizardLevel);

    // 프로젝트 개요
    prompt += this.buildProjectOverview(project);

    // 디자인 가이드
    prompt += this.buildDesignGuide(requirements.designSpec);

    // 레퍼런스 자료
    prompt += this.buildReferenceMaterials(documents);

    // 기능 요구사항
    prompt += this.buildFunctionalRequirements(requirements.functionalRequirements);

    // 기술 요구사항
    prompt += this.buildTechnicalRequirements(requirements.technicalRequirements);

    // 배포 정보
    prompt += this.buildDeploymentInfo(project.deployment);

    // 마법사 레벨별 추가 지침
    prompt += this.buildWizardLevelInstructions(wizardLevel);

    return prompt;
  }

  private getTemplate(wizardLevel: WizardLevel): string {
    return `You are an expert full-stack developer specializing in Next.js and modern web development.

# MAGIC WAND - MVP Generation Request

You are working on a project with "${wizardLevel}" wizard level.

`;
  }

  private buildProjectOverview(project: any): string {
    return `## Project Overview
- **Name:** ${project.name}
- **Description:** ${project.description}
- **Wizard Level:** ${project.wizardLevel}

`;
  }

  private buildDesignGuide(designSpec: any): string {
    if (!designSpec) return '';

    let guide = '## Design Guidelines\n';

    if (designSpec.colorTheme) {
      guide += `- **Color Theme:** ${designSpec.colorTheme}\n`;
    }

    if (designSpec.style) {
      guide += `- **Style:** ${designSpec.style}\n`;
    }

    if (designSpec.template) {
      guide += `- **Template:** ${designSpec.template}\n`;
    }

    guide += '\n';

    return guide;
  }

  private buildReferenceMaterials(documents: any[]): string {
    if (!documents || documents.length === 0) {
      return '## Reference Materials\nNo reference materials provided.\n\n';
    }

    let materials = '## Reference Materials\n\n';

    documents.forEach((doc, idx) => {
      materials += `### Reference ${idx + 1}: ${doc.fileName}\n`;
      materials += `**Description:** ${doc.description || 'N/A'}\n`;

      if (doc.parsedText) {
        materials += `**Extracted Text:**\n${doc.parsedText.substring(0, 500)}...\n`;
      }

      if (doc.extractedInsights?.document_type) {
        materials += `**Type:** ${doc.extractedInsights.document_type}\n`;
      }

      materials += '\n';
    });

    return materials + '\n';
  }

  private buildFunctionalRequirements(requirements: string[]): string {
    if (!requirements || requirements.length === 0) {
      return '## Functional Requirements\nTBD\n\n';
    }

    let reqs = '## Functional Requirements\n\n';

    requirements.forEach((req, idx) => {
      reqs += `${idx + 1}. ${req}\n`;
    });

    return reqs + '\n';
  }

  private buildTechnicalRequirements(technical: any): string {
    if (!technical) return '';

    let reqs = '## Technical Requirements\n\n';
    reqs += '### Tech Stack (Fixed)\n';
    reqs += '- **Framework:** Next.js 14+ (App Router)\n';
    reqs += '- **UI Library:** shadcn/ui\n';
    reqs += '- **Database:** Prisma ORM + Postgres\n';
    reqs += '- **Deployment:** Netlify\n\n';

    if (technical.auth) {
      reqs += `### Authentication\n- Type: ${technical.auth}\n\n`;
    }

    if (technical.pages && technical.pages.length > 0) {
      reqs += '### Required Pages\n';
      technical.pages.forEach((page: string) => {
        reqs += `- ${page}\n`;
      });
      reqs += '\n';
    }

    return reqs;
  }

  private buildDeploymentInfo(deployment: any): string {
    if (!deployment) return '';

    return `## Deployment Target
- **GitHub:** ${deployment.githubRepoUrl}
- **Branch:** ${deployment.githubBranch || 'main'}
- **Netlify Subdomain:** (Will be generated as \`{project}-{random5}.netlify.app\`)

`;
  }

  private buildWizardLevelInstructions(wizardLevel: WizardLevel): string {
    const instructions: Record<WizardLevel, string> = {
      [WizardLevel.APPRENTICE]: `
## Instructions for Apprentice Level
1. Use the template specified in the design section
2. Keep it simple and follow best practices
3. Focus on core functionality only
4. Use standard shadcn/ui components
`,
      [WizardLevel.SKILLED]: `
## Instructions for Skilled Level
1. Mix templates with customizations
2. Implement 50% of the custom requirements
3. Add some advanced features where appropriate
4. Focus on code quality and maintainability
`,
      [WizardLevel.ARCHMAGE]: `
## Instructions for Archmage Level
1. Complete freedom to implement as needed
2. All custom requirements should be implemented
3. Use advanced patterns and optimizations
4. Ensure production-ready code quality
`,
    };

    return instructions[wizardLevel];
  }

  private createGenerationPlan(complexityScore: number, wizardLevel: WizardLevel): any {
    const baseSteps = 10;
    const complexityMultiplier = complexityScore / 50;

    const phases = [
      {
        name: 'Project Setup',
        steps: 2,
        description: 'Initialize Next.js project with required dependencies',
      },
      {
        name: 'Database Schema',
        steps: Math.ceil(2 * complexityMultiplier),
        description: 'Create Prisma schema based on requirements',
      },
      {
        name: 'UI Components',
        steps: Math.ceil(3 * complexityMultiplier),
        description: 'Build pages and components using shadcn/ui',
      },
      {
        name: 'API Integration',
        steps: Math.ceil(2 * complexityMultiplier),
        description: 'Implement API routes and server actions',
      },
      {
        name: 'Deployment Setup',
        steps: 1,
        description: 'Configure for Netlify deployment',
      },
    ];

    const estimatedSteps = phases.reduce((sum, phase) => sum + phase.steps, 0);

    const riskFactors: string[] = [];
    if (complexityScore > 70) {
      riskFactors.push('High complexity may require multiple iterations');
    }
    if (wizardLevel === WizardLevel.ARCHMAGE) {
      riskFactors.push('Custom requirements may need clarification');
    }

    return {
      phases,
      estimatedSteps,
      riskFactors,
    };
  }

  private buildAttachments(files: any[]): Array<{
    type: string;
    url: string;
    description: string;
  }> {
    return files
      .filter(file => file.s3Key)
      .map(file => ({
        type: file.fileType.startsWith('image/') ? 'image' : 'document',
        url: `s3://${process.env.S3_BUCKET}/${file.s3Key}`,
        description: file.description || file.fileName,
      }));
  }

  private async savePrompt(projectId: string, prompt: string, plan: any): Promise<void> {
    // Activity Log로 저장
    await prisma.agentExecution.create({
      data: {
        projectId,
        agentId: this.getId(),
        agentName: this.getName(),
        status: 'COMPLETED',
        input: {},
        output: {
          promptLength: prompt.length,
          generationPlan: plan,
        },
      },
    });
  }
}
