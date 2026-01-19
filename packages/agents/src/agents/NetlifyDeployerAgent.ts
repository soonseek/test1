import { Agent, AgentExecutionResult, AgentStatus, CompletionMode } from '@magic-wand/agent-framework';
import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '@magic-wand/db';

interface NetlifyDeployerInput {
  projectId: string;
  githubRepoUrl: string;
  githubBranch: string;
  subdomain: string;
  netlifyAuthToken: string;
}

interface NetlifyDeployerOutput {
  deploymentResult: {
    siteId: string;
    siteUrl: string;
    deployUrl: string;
    deployId: string;
    sslUrl: string;
    buildStatus: string;
  };
}

export class NetlifyDeployerAgent extends Agent {
  private netlifyApiUrl = 'https://api.netlify.com/api/v1';

  constructor() {
    super({
      agentId: 'netlify-deployer',
      name: 'Netlify 배포자',
      role: 'GitHub 레포지토리를 Netlify에 연동하고 배포',
      trigger: {
        type: 'dependency_satisfied',
        dependencies: ['github-pusher'],
      },
      completionMode: CompletionMode.AUTO_CLOSE,
      maxRetries: 3,
      timeout: 600, // 10분
      dependencies: ['github-pusher'],
      contextSharing: {
        sharesTo: ['e2e-test-runner', 'issue-resolver'],
        data: ['netlify_site_url', 'netlify_site_id', 'deployment_logs'],
      },
    });
  }

  async execute(input: NetlifyDeployerInput): Promise<AgentExecutionResult> {
    await this.log('Netlify 배포 시작', { projectId: input.projectId, subdomain: input.subdomain });

    try {
      const authToken = input.netlifyAuthToken || process.env.NETLIFY_AUTH_TOKEN;

      if (!authToken) {
        throw new Error('NETLIFY_AUTH_TOKEN가 설정되지 않았습니다');
      }

      // 1. GitHub 레포지토리 정보 추출
      const { owner, repo } = this.parseGitHubUrl(input.githubRepoUrl);

      // 2. Netlify 사이트 생성
      const site = await this.createSite(authToken, input.subdomain);

      // 3. GitHub 레포지토리 연동
      await this.configureGitHubRepo(site, authToken, owner, repo, input.githubBranch);

      // 4. 첫 배포 트리거
      const deploy = await this.triggerDeploy(authToken, site.site_id);

      // 5. 배포 상태 모니터링
      const finalStatus = await this.monitorDeployment(authToken, deploy.deploy_id);

      const output: NetlifyDeployerOutput = {
        deploymentResult: {
          siteId: site.site_id,
          siteUrl: site.url,
          deployUrl: deploy.deploy_url,
          deployId: deploy.deploy_id,
          sslUrl: site.ssl_url,
          buildStatus: finalStatus,
        },
      };

      // 6. 데이터베이스 업데이트
      await this.updateDeployment(input.projectId, output);

      await this.log('Netlify 배포 완료', {
        siteUrl: output.deploymentResult.siteUrl,
        deployId: output.deploymentResult.deployId,
        status: finalStatus,
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

  private parseGitHubUrl(url: string): { owner: string; repo: string } {
    const patterns = [
      /https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(\.git)?$/,
      /git@github\.com:([^\/]+)\/([^\/]+?)(\.git)?$/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return { owner: match[1], repo: match[2].replace('.git', '') };
      }
    }

    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  private async createSite(authToken: string, subdomain: string): Promise<any> {
    try {
      // 랜덤 문자열 생성 (5자)
      const randomStr = crypto.randomBytes(3).toString('hex').substring(0, 5);
      const siteName = `${subdomain}-${randomStr}`;

      const response = await axios.post(
        `${this.netlifyApiUrl}/sites`,
        {
          name: siteName,
          processing_settings: {
            html: {
              pretty_urls: true,
              canonical_lowercase: true,
            },
            css: {
              bundle: true,
              minify: true,
            },
            js: {
              bundle: true,
              minify: true,
            },
            images: {
              optimize: true,
            },
          },
          build_settings: {
            cmd: 'npm run build',
            publish_dir: '.next',
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`Netlify 사이트 생성 실패: ${error.response?.data?.message || error.message}`);
    }
  }

  private async configureGitHubRepo(
    site: any,
    authToken: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<void> {
    try {
      // GitHub App 설치 필요
      // 실제로는 사용자가 Netlify에서 GitHub App을 설치해야 함
      await this.log('GitHub 연동 설정', { siteId: site.site_id, repo: `${owner}/${repo}` });

      // Netlify GitHub 연동 엔드포인트 (실제 구현 시 필요)
      // 이 부분은 Netlify UI에서 사전 설정이 필요할 수 있음
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`GitHub 연동 실패: ${error.message}`);
    }
  }

  private async triggerDeploy(authToken: string, siteId: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.netlifyApiUrl}/sites/${siteId}/deploys`,
        {
          branch: 'main',
        },
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      await this.logError(error);
      throw new Error(`배포 트리거 실패: ${error.response?.data?.message || error.message}`);
    }
  }

  private async monitorDeployment(authToken: string, deployId: string): Promise<string> {
    const maxAttempts = 60; // 최대 10분 (10초 * 60)
    const pollInterval = 10000; // 10초

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${this.netlifyApiUrl}/deploys/${deployId}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        const state = response.data.state;

        if (state === 'prepared' || state === 'building') {
          await this.log('배포 진행 중', { state, attempt: attempt + 1 });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        } else if (state === 'successful' || state === 'ready') {
          return 'success';
        } else if (state === 'failed') {
          throw new Error(`배포 실패: ${response.data.error_message || 'Unknown error'}`);
        } else {
          throw new Error(`알 수 없는 배포 상태: ${state}`);
        }
      } catch (error: any) {
        if (axios.isAxiosError(error)) {
          await this.log('배포 상태 확인 재시도', { attempt: attempt + 1 });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        } else {
          throw error;
        }
      }
    }

    throw new Error('배포 시간 초과');
  }

  private async updateDeployment(projectId: string, output: NetlifyDeployerOutput): Promise<void> {
    await prisma.deployment.update({
      where: { projectId },
      data: {
        netlifyUrl: output.deploymentResult.siteUrl,
        netlifySiteId: output.deploymentResult.siteId,
        status: 'DEPLOYED',
        completedAt: new Date(),
      },
    });
  }
}
