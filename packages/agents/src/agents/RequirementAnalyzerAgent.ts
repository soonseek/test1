import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import { WizardLevel } from '@magic-wand/shared';
import { prisma } from '@magic-wand/db';
import Anthropic from '@anthropic-ai/sdk';

interface RequirementAnalyzerInput {
  projectId: string;
  project: {
    name: string;
    description: string;
    wizardLevel: WizardLevel;
  };
  files: Array<{
    id: string;
    fileName: string;
    fileType: string;
    description: string;
    parsedText?: string;
  }>;
  survey?: any;
}

interface PRDOption {
  id: string;
  name: string;
  description: string;
  analysisMarkdown: string;
  analysis: any;
}

interface RequirementAnalyzerOutput {
  prdOptions: PRDOption[];
  summary: {
    complexityScore: number;
    estimatedTime: {
      minutes: number;
      muggleEquivalent: string;
    };
    totalRequirements: number;
    functionalRequirements: number;
    nonFunctionalRequirements: number;
  };
  selectedPRDId?: string; // User selects one PRD
}

export class RequirementAnalyzerAgent extends Agent {
  private anthropic: Anthropic;

  constructor() {
    super({
      agentId: 'requirement-analyzer',
      name: '요구사항 분석기',
      role: '프로젝트 요구사항을 심층 분석하여 PRD(제품 요구사항 문서) 생성',
      trigger: {
        type: 'event',
        event: 'survey.submitted',
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 600, // 10분 (LLM 분석 시간 고려)
      dependencies: [],
      contextSharing: {
        sharesTo: ['prompt-builder', 'code-generator'],
        data: ['analysis_markdown', 'complexity_score'],
      },
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async execute(input: RequirementAnalyzerInput): Promise<AgentExecutionResult> {
    await this.log('요구사항 심층 분석 시작', {
      projectId: input.projectId,
      projectName: input.project.name,
      wizardLevel: input.project.wizardLevel,
    });

    try {
      // 1. Collect comprehensive context
      const context = await this.gatherContext(input);
      await this.log('컨텍스트 수집 완료', {
        fileCount: input.files.length,
        hasSurvey: !!input.survey,
      });

      // 2. Generate 3 different PRD options (Conservative, Standard, Aggressive)
      await this.log('다중 PRD 옵션 생성 시작');
      const prdOptions = await this.generateMultiplePRDs(input, context);

      await this.log('PRD 옵션 생성 완료', {
        optionCount: prdOptions.length,
      });

      // 3. Calculate complexity and estimates (based on standard option)
      const summary = this.calculateSummary(prdOptions[1].analysis);

      const output: RequirementAnalyzerOutput = {
        prdOptions,
        summary,
      };

      // 4. Update deployment record (NOT create agent execution - orchestrator handles that)
      await this.updateDeploymentRecord(input.projectId, output);

      await this.log('요구사항 분석 완료', {
        complexityScore: summary.complexityScore,
        estimatedMinutes: summary.estimatedTime.minutes,
        prdCount: prdOptions.length,
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
          retryable: this.isRetryable(error),
        },
      };
    }
  }

  private async gatherContext(input: RequirementAnalyzerInput) {
    const fileContexts = await Promise.all(
      input.files.map(async (file) => {
        let content = '';
        if (file.parsedText) {
          content = file.parsedText;
        } else {
          content = `[${file.fileName}]\n${file.description}`;
        }

        return {
          fileName: file.fileName,
          fileType: file.fileType,
          description: file.description,
          content: content.substring(0, 5000), // Limit content size
        };
      })
    );

    return {
      project: {
        name: input.project.name,
        description: input.project.description,
        wizardLevel: input.project.wizardLevel,
      },
      survey: input.survey,
      files: fileContexts,
    };
  }

  private async generateMultiplePRDs(input: RequirementAnalyzerInput, context: any): Promise<PRDOption[]> {
    // Define 3 different PRD strategies
    const strategies = [
      {
        id: 'conservative',
        name: '보수형 (MVP)',
        description: '핵심 기능에 집중하여 빠르게 출시',
        promptModifier: '가장 기본적이고 핵심적인 기능만 포함하세요. 복잡한 기능은 제외하고 MVP로서 최소한으로 구현 가능한 수준으로 요구사항을 정의하세요.',
      },
      {
        id: 'standard',
        name: '표준형 (Standard)',
        description: '균형 잡힌 기능으로 실용적인 구현',
        promptModifier: '실용적이고 균형 잡힌 기능을 포함하세요. 대부분의 일반적인 사용 사례를 cover하면서도 과도하게 복잡하지 않은 수준으로 요구사항을 정의하세요.',
      },
      {
        id: 'aggressive',
        name: '적극형 (Full-featured)',
        description: '모든 고급 기능과 확장성을 고려한 완성도',
        promptModifier: '가장 완성도 높고 포괄적인 기능을 포함하세요. 고급 기능, 확장성, 예외 처리 등 모든 면을 고려한 최상의 사용자 경험을 제공하는 수준으로 요구사항을 정의하세요.',
      },
    ];

    const prdOptions: PRDOption[] = [];

    // Generate PRD for each strategy
    for (const strategy of strategies) {
      await this.log(`${strategy.name} PRD 생성 시작`);

      try {
        // Perform analysis with strategy-specific prompt
        const analysisResult = await this.performDeepAnalysisWithStrategy(context, strategy.promptModifier);

        // Generate markdown document
        const markdownReport = await this.generatePRDDocument(input, context, analysisResult, strategy);

        prdOptions.push({
          id: strategy.id,
          name: strategy.name,
          description: strategy.description,
          analysisMarkdown: markdownReport,
          analysis: analysisResult,
        });

        await this.log(`${strategy.name} PRD 생성 완료`);
      } catch (error) {
        await this.logError(new Error(`${strategy.name} PRD 생성 실패: ${error}`));
      }
    }

    return prdOptions;
  }

  private async performDeepAnalysis(context: any) {
    const prompt = this.buildAnalysisPrompt(context);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.3, // Lower temperature for more structured output
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract the analysis from Claude's response
      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      // Log raw response for debugging
      console.log('[RequirementAnalyzer] Raw LLM response length:', text.length);
      console.log('[RequirementAnalyzer] First 500 chars:', text.substring(0, 500));
      console.log('[RequirementAnalyzer] Last 500 chars:', text.substring(text.length - 500));

      return this.parseAnalysisResponse(text);
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`LLM 분석 실패: ${error.message}`);
    }
  }

  private async performDeepAnalysisWithStrategy(context: any, strategyModifier: string) {
    const prompt = this.buildAnalysisPrompt(context, strategyModifier);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      console.log('[RequirementAnalyzer] Strategy-based LLM response length:', text.length);

      return this.parseAnalysisResponse(text);
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`LLM 분석 실패: ${error.message}`);
    }
  }

  private buildAnalysisPrompt(context: any, strategyModifier?: string): string {
    const { project, survey, files } = context;

    const strategySection = strategyModifier ? `
## 🎯 전략 지시사항
${strategyModifier}
` : '';

    return `# 요구사항 심층 분석 요청

당신은 BMad Methodology, Moai ADK, Superpowers 워크플로우를 숙달한 시니어 PM이자 기술 분석가입니다.
제공된 프로젝트 정보를 바탕으로 **실제 분석**을 수행해주세요.
${strategySection}

## 프로젝트 개요
- **프로젝트명**: ${project.name}
- **설명**: ${project.description}
- **마법사 레벨**: ${project.wizardLevel}
  - APPRENTICE: 인턴 마법사 (기본적 MVP)
  - SKILLED: 숙련자 마법사 (중간 난이도)
  - ARCHMAGE: 대마법사 (고급 기능)

## 설문조사 응답
${survey ? JSON.stringify(survey, null, 2) : '없음'}

## 참고 파일 (${files.length}개)
${files.map((f: any) => `
- **${f.fileName}** (${f.fileType})
  설명: ${f.description}
  ${f.content ? `내용: ${f.content.substring(0, 500)}...` : ''}
`).join('\n')}

---

## 분석 지시사항

다음 **4가지 차원**에서 심층 분석을 수행하세요:

### 1. 비즈니스 요구사항 분석 (Business Requirements)
- 사용자의 핵심 문제는 무엇인가?
- 어떤 가치를 제공하려 하는가?
- 타겟 사용자는 누구인가?
- 비즈니스 목표는 무엇인가?

### 2. 기능적 요구사항 분석 (Functional Requirements)
- **필수 기능** (FR-001, FR-002, ...) 형식으로 나열
- 각 기능에 대해 구체적인 Acceptance Criteria 정의
- User Story 형식: "사용자로서[role], 나는[goal]을 위해, [기능]을 원한다"
- 기능 간 우선순위와 의존관계 분석

### 3. 비기능적 요구사항 분석 (Non-Functional Requirements)
- **성능**: 로딩 시간, 응답 시간, 동시 사용자 수
- **보안**: 인증 방식, 데이터 보호, 권한 관리
- **UX/UI**: 디자인 스타일, 반응형, 접근성
- **확장성**: 향후 추가 가능한 기능
- **호환성**: 브라우저, 디바이스 지원

### 4. 기술적 요구사항 분석 (Technical Requirements)
- **아키텍처**: Next.js Full-Stack (App Router + API Routes)
- **기술 스택 (고정값)**: 다음 기술 스택은 **절대 변경 불가**합니다
  - Frontend: Next.js 14+ (App Router)
  - UI: shadcn/ui (Radix UI + Tailwind CSS)
  - Backend: Next.js API Routes (Server-side)
  - Database: Prisma ORM + PostgreSQL (Netlify DB)
  - Deployment: Netlify (Serverless Functions) - Vercel 사용 불가
- **데이터 모델**: 주요 엔티티와 관계 (Prisma Schema)
- **외부 연동**: 필요한 API, 서드파티 서비스

---

## ⚠️ 중요: 기술 스택 고정
MAGIC WAND의 기술 스택은 **PRD에 명시된 대로 고정**되어 있으며, 프로젝트의 복잡도나 규모와 상관없이 **반드시 다음 기술을 사용**해야 합니다:
- Database는 **LocalStorage 사용 불가** - 반드시 Prisma + PostgreSQL 사용
- Deployment는 **Vercel 사용 불가** - 반드시 Netlify 사용
- Client-side only 개발 불가 - 반드시 Next.js API Routes 사용

---

## 출력 형식 (JSON)

다음 JSON 형식으로 **엄격하게** 출력하세요:

\`\`\`json
{
  "businessRequirements": {
    "problemStatement": "문제 정의",
    "targetUsers": ["타겟 사용자 1", "타겟 사용자 2"],
    "valueProposition": "가치 제안",
    "businessGoals": ["목표 1", "목표 2"]
  },
  "functionalRequirements": [
    {
      "id": "FR-001",
      "title": "기능 제목",
      "priority": "HIGH|MEDIUM|LOW",
      "userStory": "사용자 스토리",
      "acceptanceCriteria": [
        "조건 1",
        "조건 2"
      ],
      "dependencies": ["FR-002"]
    }
  ],
  "nonFunctionalRequirements": {
    "performance": {
      "loadTime": "< 2초",
      "responseTime": "< 500ms",
      "concurrentUsers": "100명 이상"
    },
    "security": {
      "authentication": "이메일/소셜 로그인",
      "dataProtection": "데이터 암호화",
      "authorization": "RBAC"
    },
    "uxui": {
      "designStyle": "MINIMAL|MODERN|PLAYFUL|COLORFUL",
      "responsive": true,
      "accessibility": "WCAG 2.1"
    },
    "scalability": ["확장 가능성 1", "확장 가능성 2"],
    "compatibility": {
      "browsers": ["Chrome", "Safari", "Firefox"],
      "devices": ["Desktop", "Tablet", "Mobile"]
    }
  },
  "technicalRequirements": {
    "architecture": "아키텍처 설명",
    "techStack": {
      "frontend": "Next.js 14+ (App Router)",
      "ui": "shadcn/ui (Radix UI + Tailwind CSS)",
      "backend": "Next.js API Routes (Server-side)",
      "database": "Prisma ORM + PostgreSQL (Netlify DB)",
      "deployment": "Netlify (Serverless Functions)"
    },
    "dataModel": [
      {
        "entity": "User",
        "fields": ["id", "email", "name"]
      }
    ],
    "externalIntegrations": []
  },
  "riskAssessment": [
    {
      "risk": "리스크 설명",
      "impact": "HIGH|MEDIUM|LOW",
      "mitigation": "완화 전략"
    }
  ],
  "totalRequirements": 10
}
\`\`\`

## ⚠️⚠️⚠️ 기술 스택 관련 **매우 중요한 제약사항**

1. **Database**: 반드시 **Prisma ORM + PostgreSQL**을 사용해야 합니다
   - ❌ LocalStorage, IndexedDB 등 클라이언트 저장소 사용 불가
   - ❌ MongoDB, MySQL 등 다른 DB 사용 불가
   - ✅ Prisma Schema 정의 필요
   - ✅ Netlify PostgreSQL 사용

2. **Deployment**: 반드시 **Netlify**만 사용해야 합니다
   - ❌ Vercel, Railway, Render 등 다른 호스팅 사용 불가
   - ❌ Static Export 사용 불가
   - ✅ Netlify Serverless Functions 사용
   - ✅ Netlify DB 연동

3. **Backend**: 반드시 **Next.js API Routes**를 사용해야 합니다
   - ❌ Client-side only 개발 불가
   - ❌ Firebase, Supabase 등 BaaS 사용 불가
   - ✅ Server-side API Routes 구현
   - ✅ Prisma Client 사용한 DB 쿼리

4. **프로젝트 복잡도와 무관하게 위 제약사항을 반드시 준수**해야 합니다
   - 투두앱이라도 LocalStorage가 아닌 PostgreSQL 사용
   - 간단한 앱이라도 API Routes와 Prisma 사용
   - 모든 데이터는 Server-side에서 관리

중요: 위 기술 스택 제약사항을 **반드시 준수**하면서, 실제 프로젝트에 맞는 구체적이고 실현 가능한 분석 결과를 제공하세요.
`;
  }

  private parseAnalysisResponse(text: string): any {
    console.log('[RequirementAnalyzer] ========== Starting JSON parsing ==========');
    console.log('[RequirementAnalyzer] Raw response length:', text.length);
    console.log('[RequirementAnalyzer] First 300 chars:', text.substring(0, 300));

    let jsonText = null;
    let extractionMethod = '';

    // Method 1: Standard ```json code block
    let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      extractionMethod = 'Standard ```json block';
    }

    // Method 2: Try ```json without closing ``` (LLM sometimes cuts off)
    if (!jsonText) {
      jsonMatch = text.match(/```json\s*([\s\S]*)/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        extractionMethod = 'Unclosed ```json block';
      }
    }

    // Method 3: Try ``` (no language specified)
    if (!jsonText) {
      jsonMatch = text.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
        extractionMethod = 'Plain ``` block';
      }
    }

    // Method 4: Look for { ... } pattern (JSON object directly in text)
    if (!jsonText) {
      jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
        extractionMethod = 'Direct JSON object';
      }
    }

    if (!jsonText) {
      console.error('[RequirementAnalyzer] ❌ Could not extract JSON from response');
      console.error('[RequirementAnalyzer] Response does not contain any JSON-like content');
      console.error('[RequirementAnalyzer] Last 500 chars:', text.substring(text.length - 500));
      throw new Error('LLM response does not contain valid JSON. Please check the prompt and response format.');
    }

    console.log('[RequirementAnalyzer] ✓ JSON extracted using:', extractionMethod);
    console.log('[RequirementAnalyzer] Extracted JSON length:', jsonText.length);
    console.log('[RequirementAnalyzer] First 200 chars of JSON:', jsonText.substring(0, 200));

    // Clean up common JSON issues
    // Remove trailing commas (common in LLM outputs)
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

    // Try to parse
    try {
      const parsed = JSON.parse(jsonText);
      console.log('[RequirementAnalyzer] ✓✓✓ JSON parsed successfully!');
      console.log('[RequirementAnalyzer] Top-level keys:', Object.keys(parsed));

      // Validate expected structure
      const expectedKeys = ['businessRequirements', 'functionalRequirements', 'nonFunctionalRequirements', 'technicalRequirements'];
      const missingKeys = expectedKeys.filter(key => !parsed[key]);
      if (missingKeys.length > 0) {
        console.warn('[RequirementAnalyzer] ⚠️  Missing expected keys:', missingKeys);
      }

      return parsed;
    } catch (e: any) {
      console.error('[RequirementAnalyzer] ❌❌❌ JSON parsing FAILED!');
      console.error('[RequirementAnalyzer] Error message:', e.message);

      // Try to show error location
      const posMatch = e.message.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        const start = Math.max(0, pos - 200);
        const end = Math.min(jsonText.length, pos + 200);
        console.error('[RequirementAnalyzer] Error context (200 chars around error):');
        console.error(jsonText.substring(start, end));
      }

      // Show full JSON for debugging
      console.error('[RequirementAnalyzer] Full JSON text that failed to parse:');
      console.error(jsonText);

      throw new Error(`Failed to parse LLM JSON response: ${e.message}`);
    }
  }

  private async generatePRDDocument(
    input: RequirementAnalyzerInput,
    context: any,
    analysis: any,
    strategy?: { id: string; name: string; description: string }
  ): Promise<string> {
    const { project, survey } = context;

    const prd = `# 요구사항 분석 보고서 (Requirements Analysis Report)

**프로젝트명**: ${project.name}
**생성일시**: ${new Date().toLocaleString('ko-KR')}
**마법사 레벨**: ${project.wizardLevel}
**분석 방법론**: BMad Method + Moai ADK + Superpowers
${strategy ? `**전략 유형**: ${strategy.name}\n**전략 설명**: ${strategy.description}` : ''}

---

## 📋 목차 (Table of Contents)

1. [비즈니스 요구사항](#1-비즈니스-요구사항-business-requirements)
2. [기능적 요구사항](#2-기능적-요구사항-functional-requirements)
3. [비기능적 요구사항](#3-비기능적-요구사항-non-functional-requirements)
4. [기술적 요구사항](#4-기술적-요구사항-technical-requirements)
5. [리스크 평가](#5-리스크-평가-risk-assessment)
6. [다음 단계](#6-다음-단계-next-steps)

---

## 1. 비즈니스 요구사항 (Business Requirements)

### 1.1 문제 정의 (Problem Statement)
${analysis.businessRequirements?.problemStatement || 'N/A'}

### 1.2 타겟 사용자 (Target Users)
${analysis.businessRequirements?.targetUsers?.map((u: string) => `- ${u}`).join('\n') || '- N/A'}

### 1.3 가치 제안 (Value Proposition)
${analysis.businessRequirements?.valueProposition || 'N/A'}

### 1.4 비즈니스 목표 (Business Goals)
${analysis.businessRequirements?.businessGoals?.map((g: string) => `- ${g}`).join('\n') || '- N/A'}

---

## 2. 기능적 요구사항 (Functional Requirements)

${analysis.functionalRequirements?.map((req: any) => `
### ${req.id}: ${req.title}

**우선순위**: \`${req.priority}\`

**User Story**:
> ${req.userStory}

**Acceptance Criteria**:
${req.acceptanceCriteria.map((ac: string) => `- [ ] ${ac}`).join('\n')}

${req.dependencies?.length > 0 ? `**의존관계**: ${req.dependencies.join(', ')}` : ''}
---
`).join('\n') || '기능적 요구사항이 없습니다.'}

**총 기능 요구사항**: ${analysis.functionalRequirements?.length || 0}개

---

## 3. 비기능적 요구사항 (Non-Functional Requirements)

### 3.1 성능 (Performance)
- **페이지 로딩 시간**: ${analysis.nonFunctionalRequirements?.performance?.loadTime || 'N/A'}
- **API 응답 시간**: ${analysis.nonFunctionalRequirements?.performance?.responseTime || 'N/A'}
- **동시 사용자 수**: ${analysis.nonFunctionalRequirements?.performance?.concurrentUsers || 'N/A'}

### 3.2 보안 (Security)
- **인증 방식**: ${analysis.nonFunctionalRequirements?.security?.authentication || 'N/A'}
- **데이터 보호**: ${analysis.nonFunctionalRequirements?.security?.dataProtection || 'N/A'}
- **권한 관리**: ${analysis.nonFunctionalRequirements?.security?.authorization || 'N/A'}

### 3.3 UX/UI
- **디자인 스타일**: \`${survey?.designStyle || 'MODERN'}\`
- **컬러 테마**: ${survey?.colorTheme || 'purple'}
- **반응형**: ${analysis.nonFunctionalRequirements?.uxui?.responsive ? '✅ 지원' : '❌ 미지원'}
- **접근성**: ${analysis.nonFunctionalRequirements?.uxui?.accessibility || 'N/A'}

### 3.4 확장성 (Scalability)
${analysis.nonFunctionalRequirements?.scalability?.map((s: string) => `- ${s}`).join('\n') || '- N/A'}

### 3.5 호환성 (Compatibility)
**지원 브라우저**:
${analysis.nonFunctionalRequirements?.compatibility?.browsers?.map((b: string) => `- ${b}`).join('\n') || '- N/A'}

**지원 디바이스**:
${analysis.nonFunctionalRequirements?.compatibility?.devices?.map((d: string) => `- ${d}`).join('\n') || '- N/A'}

---

## 4. 기술적 요구사항 (Technical Requirements)

### 4.1 시스템 아키텍처
${analysis.technicalRequirements?.architecture || 'N/A'}

### 4.2 기술 스택 (Tech Stack)
| 계층 | 기술 |
|------|------|
| **Frontend** | ${analysis.technicalRequirements?.techStack?.frontend || 'Next.js 14+'} |
| **UI Library** | ${analysis.technicalRequirements?.techStack?.ui || 'shadcn/ui'} |
| **Backend** | ${analysis.technicalRequirements?.techStack?.backend || 'Next.js API Routes'} |
| **Database** | ${analysis.technicalRequirements?.techStack?.database || 'Prisma + PostgreSQL'} |
| **Deployment** | ${analysis.technicalRequirements?.techStack?.deployment || 'Netlify/Vercel'} |

### 4.3 데이터 모델 (Data Model)
${analysis.technicalRequirements?.dataModel?.map((entity: any) => `
#### **${entity.entity}**
${entity.fields.map((f: string) => `- \`${f}\``).join('\n')}
`).join('\n') || 'N/A'}

### 4.4 외부 연동 (External Integrations)
${analysis.technicalRequirements?.externalIntegrations?.length > 0
  ? analysis.technicalRequirements.externalIntegrations.map((i: string) => `- ${i}`).join('\n')
  : '- 없음'}

---

## 5. 리스크 평가 (Risk Assessment)

| 리스크 | 영향 | 완화 전략 |
|--------|------|-----------|
${analysis.riskAssessment?.map((risk: any) =>
  `| ${risk.risk} | \`${risk.impact}\` | ${risk.mitigation} |`
).join('\n') || '| N/A | N/A | N/A |'}

---

## 6. 다음 단계 (Next Steps)

### ✅ 완료된 작업
- [x] 요구사항 심층 분석
- [x] PRD 문서 생성

### 🔄 진행 예정 작업
- [ ] 문서 파싱 및 상세 분석 (Document Parser Agent)
- [ ] 프롬프트 빌딩 (Prompt Builder Agent)
- [ ] 코드 생성 (Code Generator Agent)
- [ ] GitHub 푸시 (GitHub Pusher Agent)
- [ ] Netlify 배포 (Netlify Deployer Agent)
- [ ] E2E 테스트 (E2E Test Runner Agent)

---

## 📊 분석 통계 (Analysis Statistics)

- **총 요구사항 수**: ${analysis.totalRequirements || 0}개
- **기능적 요구사항**: ${analysis.functionalRequirements?.length || 0}개
- **비기능적 요구사항 카테고리**: 5개 (성능, 보안, UX/UI, 확장성, 호환성)
- **식별된 리스크**: ${analysis.riskAssessment?.length || 0}개

---

*이 문서는 AI에 의해 자동 생성되었습니다.*
*Generated by MAGIC WAND RequirementAnalyzerAgent*
*Methodology: BMad + Moai ADK + Superpowers*
`;

    return prd;
  }

  private calculateSummary(analysis: any) {
    const functionalCount = analysis.functionalRequirements?.length || 0;
    const totalRequirements = analysis.totalRequirements || functionalCount;
    const nonFunctionalCount = 5; // Fixed: performance, security, uxui, scalability, compatibility

    // Calculate complexity score based on analysis
    let complexityScore = 10; // Base score

    // Functional requirements impact
    complexityScore += functionalCount * 5;

    // Non-functional complexity
    if (analysis.nonFunctionalRequirements?.security?.authentication !== 'NONE') {
      complexityScore += 10;
    }
    if (analysis.nonFunctionalRequirements?.performance?.concurrentUsers?.includes('100')) {
      complexityScore += 5;
    }

    // Risk factors
    const highRiskCount = analysis.riskAssessment?.filter((r: any) => r.impact === 'HIGH').length || 0;
    complexityScore += highRiskCount * 10;

    // Wizard level multiplier
    const wizardLevel = this.context.get('wizardLevel') || 'APPRENTICE';
    switch (wizardLevel) {
      case 'ARCHMAGE':
        complexityScore *= 1.5;
        break;
      case 'SKILLED':
        complexityScore *= 1.2;
        break;
    }

    complexityScore = Math.min(100, Math.round(complexityScore));

    // Estimate time
    const baseTime = 30; // 30 minutes
    const minutes = Math.round(baseTime + (complexityScore * 2));
    const muggleHours = Math.ceil(minutes / 60);
    const muggleDays = Math.ceil(muggleHours / 8);

    let muggleEquivalent: string;
    if (muggleDays >= 1) {
      muggleEquivalent = `Junior 1명 × ${muggleDays}일`;
    } else if (muggleHours >= 4) {
      muggleEquivalent = `Junior 1명 × ${muggleHours}시간`;
    } else {
      muggleEquivalent = `Senior 1명 × ${Math.ceil(muggleHours / 2)}시간`;
    }

    return {
      complexityScore,
      estimatedTime: {
        minutes,
        muggleEquivalent,
      },
      totalRequirements,
      functionalRequirements: functionalCount,
      nonFunctionalRequirements: nonFunctionalCount,
    };
  }

  private async updateDeploymentRecord(projectId: string, output: RequirementAnalyzerOutput) {
    await prisma.deployment.upsert({
      where: { projectId },
      create: {
        projectId,
        githubRepoUrl: '',
        status: 'PENDING',
        estimatedTime: output.summary.estimatedTime.minutes,
        estimatedMuggleMandays: output.summary.estimatedTime.muggleEquivalent,
        logs: {
          analysis: output.summary,
        } as any,
      },
      update: {
        estimatedTime: output.summary.estimatedTime.minutes,
        estimatedMuggleMandays: output.summary.estimatedTime.muggleEquivalent,
        logs: {
          analysis: output.summary,
        } as any,
      },
    });
  }

  private isRetryable(error: any): boolean {
    // Retry on API rate limits, network errors, etc.
    if (error.status === 429) return true; // Rate limit
    if (error.status >= 500) return true; // Server errors
    if (error.code === 'ECONNRESET') return true; // Network error
    return false;
  }
}
