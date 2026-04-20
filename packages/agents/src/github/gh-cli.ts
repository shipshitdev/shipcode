import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type GitHubIssue,
  type GitHubIssueComment,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  type GitHubStatusLabel,
  PRD_MANAGED_DISCRETE_LABELS,
  PRD_MANAGED_LABEL_PREFIXES,
  type PullRequestDetail,
  type PullRequestListFilter,
  type PullRequestListItem,
  type PullRequestReviewDecision,
  type PullRequestState,
} from '@shipcode/shared';

const execFileAsync = promisify(execFile);

/**
 * Detect whether a `gh project item-add` failure is the "already on the
 * board" case, which we treat as success in addIssueToProject. The exact
 * stderr text varies between gh versions; match a few known shapes
 * conservatively (case-insensitive) to avoid false positives.
 */
function isAlreadyOnBoardError(stderr: string): boolean {
  if (!stderr) return false;
  return (
    /already.*(in|on).*project/i.test(stderr) ||
    /item.*already.*(added|exists)/i.test(stderr) ||
    /already an item/i.test(stderr)
  );
}

export interface PullRequestFeedback {
  number: number;
  url: string;
  isDraft: boolean;
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
}

export class GhCli {
  constructor(private cwd: string) {}

  private async getRepoCoordinates(): Promise<{ owner: string; repo: string }> {
    const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], {
      cwd: this.cwd,
    });
    const parsed = JSON.parse(stdout) as { owner?: { login?: string }; name?: string };
    const owner = parsed.owner?.login?.trim();
    const repo = parsed.name?.trim();
    if (!owner || !repo) {
      throw new Error('Failed to resolve repository owner/name via gh repo view');
    }
    return { owner, repo };
  }

  async listRepoLabels(): Promise<string[]> {
    const { stdout } = await execFileAsync(
      'gh',
      ['label', 'list', '--limit', '200', '--json', 'name'],
      { cwd: this.cwd },
    );

    const raw = JSON.parse(stdout) as Array<{ name?: string }>;
    return raw.map((label) => label.name).filter((name): name is string => !!name);
  }

  async listRepoLabelsWithMeta(): Promise<
    Array<{ name: string; color: string; description: string }>
  > {
    const { stdout } = await execFileAsync(
      'gh',
      ['label', 'list', '--limit', '200', '--json', 'name,color,description'],
      { cwd: this.cwd },
    );

    const raw = JSON.parse(stdout) as Array<{
      name?: string;
      color?: string;
      description?: string;
    }>;
    return raw
      .filter(
        (label): label is { name: string; color?: string; description?: string } => !!label.name,
      )
      .map((label) => ({
        name: label.name,
        color: label.color ?? '',
        description: label.description ?? '',
      }));
  }

  async createLabel(label: { name: string; color: string; description: string }): Promise<void> {
    try {
      await execFileAsync(
        'gh',
        ['label', 'create', label.name, '--color', label.color, '--description', label.description],
        { cwd: this.cwd },
      );
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
      if (/already exists/i.test(stderr)) return;
      throw err;
    }
  }

  async ensureLabels(
    labels: ReadonlyArray<{ name: string; color: string; description: string }>,
  ): Promise<{
    created: string[];
    alreadyPresent: string[];
    failed: Array<{ name: string; error: string }>;
  }> {
    const existing = new Set(await this.listRepoLabels());
    const created: string[] = [];
    const alreadyPresent: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const label of labels) {
      if (existing.has(label.name)) {
        alreadyPresent.push(label.name);
        continue;
      }
      try {
        await this.createLabel(label);
        created.push(label.name);
      } catch (err) {
        failed.push({ name: label.name, error: String((err as Error).message ?? err) });
      }
    }

    return { created, alreadyPresent, failed };
  }

  private async filterExistingLabels(labels: string[]): Promise<string[]> {
    if (labels.length === 0) return [];
    const available = new Set(await this.listRepoLabels());
    return labels.filter((label) => available.has(label));
  }

  private isManagedPrdLabel(label: string): boolean {
    return (
      PRD_MANAGED_DISCRETE_LABELS.includes(label as (typeof PRD_MANAGED_DISCRETE_LABELS)[number]) ||
      PRD_MANAGED_LABEL_PREFIXES.some((prefix: string) => label.startsWith(prefix))
    );
  }

  private async syncIssueLabels(issueNumber: number, labels: string[]): Promise<void> {
    const next = await this.filterExistingLabels(labels);
    let current: string[] = [];

    try {
      const issue = await this.getIssue(issueNumber);
      current = issue.labels;
    } catch {
      current = [];
    }

    const toRemove = current.filter(
      (label) => this.isManagedPrdLabel(label) && !next.includes(label),
    );
    const toAdd = next.filter((label) => !current.includes(label));

    for (const label of toRemove) {
      try {
        await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--remove-label', label], {
          cwd: this.cwd,
        });
      } catch {
        // Removal is best-effort.
      }
    }

    for (const label of toAdd) {
      try {
        await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], {
          cwd: this.cwd,
        });
      } catch {
        // Addition is best-effort.
      }
    }
  }

  async listIssues(label: string): Promise<GitHubIssue[]> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue',
        'list',
        '--label',
        label,
        '--state',
        'open',
        '--json',
        'number,title,body,labels,assignees,author,state,url',
        '--limit',
        '50',
      ],
      { cwd: this.cwd },
    );

    const raw = JSON.parse(stdout) as Record<string, unknown>[];
    return raw.map((r) => ({
      number: r.number as number,
      title: r.title as string,
      body: (r.body as string) ?? null,
      labels: ((r.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
      assignee: ((r.assignees as Array<{ login: string }>) ?? [])[0]?.login ?? null,
      state: ((r.state as string)?.toLowerCase() ?? 'open') as 'open' | 'closed',
      url: (r.url as string) ?? '',
      author: (r.author as { login?: string } | null)?.login
        ? { login: (r.author as { login: string }).login }
        : undefined,
    }));
  }

  async listAllIssues(): Promise<GitHubIssue[]> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'all',
        '--json',
        'number,title,body,labels,assignees,author,state,url',
        '--limit',
        '200',
      ],
      { cwd: this.cwd },
    );

    const raw = JSON.parse(stdout) as Record<string, unknown>[];
    return raw.map((r) => ({
      number: r.number as number,
      title: r.title as string,
      body: (r.body as string) ?? null,
      labels: ((r.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
      assignee: ((r.assignees as Array<{ login: string }>) ?? [])[0]?.login ?? null,
      state: ((r.state as string)?.toLowerCase() ?? 'open') as 'open' | 'closed',
      url: (r.url as string) ?? '',
      author: (r.author as { login?: string } | null)?.login
        ? { login: (r.author as { login: string }).login }
        : undefined,
    }));
  }

  async listAllAgentIssues(): Promise<GitHubIssue[]> {
    const [claude, codex] = await Promise.all([
      this.listIssues('agent:claude').catch(() => []),
      this.listIssues('agent:codex').catch(() => []),
    ]);
    // Deduplicate by issue number
    const seen = new Set<number>();
    const merged: GitHubIssue[] = [];
    for (const issue of [...claude, ...codex]) {
      if (!seen.has(issue.number)) {
        seen.add(issue.number);
        merged.push(issue);
      }
    }
    return merged;
  }

  async getIssue(number: number): Promise<GitHubIssue> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue',
        'view',
        String(number),
        '--json',
        'number,title,body,labels,assignees,author,state,url',
      ],
      { cwd: this.cwd },
    );

    const r = JSON.parse(stdout) as Record<string, unknown>;
    return {
      number: r.number as number,
      title: r.title as string,
      body: (r.body as string) ?? null,
      labels: ((r.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
      assignee: ((r.assignees as Array<{ login: string }>) ?? [])[0]?.login ?? null,
      state: ((r.state as string)?.toLowerCase() ?? 'open') as 'open' | 'closed',
      url: (r.url as string) ?? '',
      author: (r.author as { login?: string } | null)?.login
        ? { login: (r.author as { login: string }).login }
        : undefined,
    };
  }

  async createIssue(options: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<GitHubIssue> {
    // Body is piped via stdin (`--body-file -`) to avoid argv length limits
    // and shell-escaping issues for multi-KB PRDs.
    const args = ['issue', 'create', '--title', options.title, '--body-file', '-'];
    const labels = await this.filterExistingLabels(options.labels ?? []);
    if (labels.length) args.push('--label', labels.join(','));

    const stdout = await this.spawnWithStdin('gh', args, options.body);
    // gh issue create outputs the issue URL, e.g. https://github.com/owner/repo/issues/42
    const match = stdout.match(/\/issues\/(\d+)/);
    if (!match) throw new Error(`Failed to parse issue number from: ${stdout}`);
    return this.getIssue(parseInt(match[1], 10));
  }

  /**
   * Add an existing issue to a GitHub Projects v2 board, best-effort.
   * Shells `gh project item-add <number> --owner <owner> --url <issueUrl>`.
   *
   * `--owner` accepts a bare login for both org and user Projects v2, so the
   * caller does not need to distinguish `ownerType` at this layer.
   *
   * Idempotent: if `gh` reports the issue is already on the board, this
   * method resolves with `{added: false, alreadyPresent: true}` instead of
   * throwing. Any other non-zero exit propagates as a thrown Error so the
   * caller can surface or swallow as appropriate.
   */
  async addIssueToProject(opts: {
    projectNumber: number;
    owner: string;
    issueUrl: string;
  }): Promise<{ added: boolean; alreadyPresent: boolean }> {
    try {
      await execFileAsync(
        'gh',
        [
          'project',
          'item-add',
          String(opts.projectNumber),
          '--owner',
          opts.owner,
          '--url',
          opts.issueUrl,
        ],
        { cwd: this.cwd },
      );
      return { added: true, alreadyPresent: false };
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
      if (isAlreadyOnBoardError(stderr)) {
        return { added: false, alreadyPresent: true };
      }
      throw err;
    }
  }

  async editIssueBody(issueNumber: number, body: string): Promise<void> {
    // Piping via stdin avoids argv length limits for multi-KB PRD bodies
    // and avoids any shell-escaping risk for backticks, quotes, etc.
    await this.spawnWithStdin(
      'gh',
      ['issue', 'edit', String(issueNumber), '--body-file', '-'],
      body,
    );
  }

  async editIssue(options: {
    issueNumber: number;
    title: string;
    body: string;
    labels?: string[];
  }): Promise<void> {
    await this.spawnWithStdin(
      'gh',
      ['issue', 'edit', String(options.issueNumber), '--title', options.title, '--body-file', '-'],
      options.body,
    );
    await this.syncIssueLabels(options.issueNumber, options.labels ?? []);
  }

  /**
   * Run a command with stdin piped from a string, async. Used for gh issue
   * create/edit where the body can exceed argv limits or contain characters
   * that would need shell-escaping with --body.
   */
  private spawnWithStdin(command: string, args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else
          reject(
            new Error(`${command} ${args.join(' ')} exited with code ${code}: ${stderr.trim()}`),
          );
      });
      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  async createPR(options: {
    title: string;
    body: string;
    base?: string;
    head: string;
    labels?: string[];
  }): Promise<number> {
    const args = [
      'pr',
      'create',
      '--title',
      options.title,
      '--body',
      options.body,
      '--head',
      options.head,
    ];
    if (options.base) args.push('--base', options.base);
    if (options.labels?.length) args.push('--label', options.labels.join(','));

    const { stdout } = await execFileAsync('gh', args, { cwd: this.cwd });
    const match = stdout.match(/\/pull\/(\d+)/);
    if (!match) throw new Error(`Failed to parse PR number from: ${stdout}`);
    return parseInt(match[1], 10);
  }

  async findPullRequestByHead(
    head: string,
  ): Promise<Pick<PullRequestFeedback, 'number' | 'url' | 'isDraft'> | null> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'all',
        '--head',
        head,
        '--json',
        'number,url,isDraft',
        '--limit',
        '1',
      ],
      { cwd: this.cwd },
    );
    const rows = JSON.parse(stdout) as Array<{ number: number; url: string; isDraft: boolean }>;
    const found = rows[0];
    return found ? { number: found.number, url: found.url, isDraft: !!found.isDraft } : null;
  }

  async listPullRequests(options?: {
    state?: PullRequestListFilter;
    limit?: number;
  }): Promise<PullRequestListItem[]> {
    const state = options?.state ?? 'open';
    const limit = options?.limit ?? 30;
    const ghState =
      state === 'merged'
        ? 'merged'
        : state === 'closed'
          ? 'closed'
          : state === 'all'
            ? 'all'
            : 'open';
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        ghState,
        '--json',
        'number,title,author,headRefName,baseRefName,isDraft,state,reviewDecision,updatedAt,url,labels,closingIssuesReferences',
        '--limit',
        String(limit),
      ],
      { cwd: this.cwd },
    );
    const rows = JSON.parse(stdout) as Array<{
      number: number;
      title: string;
      author: { login: string } | null;
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
      state: string;
      reviewDecision: string | null;
      updatedAt: string;
      url: string;
      labels: Array<{ name: string }>;
      closingIssuesReferences: Array<{ number: number }> | null;
    }>;
    return rows.map((row) => ({
      number: row.number,
      title: row.title,
      author: row.author?.login ?? null,
      headRefName: row.headRefName,
      baseRefName: row.baseRefName,
      isDraft: !!row.isDraft,
      state: row.state as PullRequestState,
      reviewDecision: (row.reviewDecision as PullRequestReviewDecision) ?? null,
      updatedAt: row.updatedAt,
      url: row.url,
      labels: row.labels.map((l) => l.name),
      linkedIssueNumbers: (row.closingIssuesReferences ?? []).map((r) => r.number),
    }));
  }

  async updatePullRequest(options: {
    prNumber: number;
    title: string;
    body: string;
  }): Promise<void> {
    await this.spawnWithStdin(
      'gh',
      ['pr', 'edit', String(options.prNumber), '--title', options.title, '--body-file', '-'],
      options.body,
    );
  }

  async setIssueLabelPresence(issueNumber: number, label: string, present: boolean): Promise<void> {
    let current: string[] = [];
    try {
      current = (await this.getIssue(issueNumber)).labels;
    } catch {
      current = [];
    }

    if (present && current.includes(label)) return;
    if (!present && !current.includes(label)) return;

    try {
      await execFileAsync(
        'gh',
        ['issue', 'edit', String(issueNumber), present ? '--add-label' : '--remove-label', label],
        { cwd: this.cwd },
      );
    } catch {
      // Best-effort marker sync; local cache still reflects the blocker state.
    }
  }

  async getPullRequestFeedback(prNumber: number): Promise<PullRequestFeedback> {
    const { owner, repo } = await this.getRepoCoordinates();
    const query = `
      query($owner:String!, $repo:String!, $number:Int!) {
        repository(owner:$owner, name:$repo) {
          pullRequest(number:$number) {
            number
            url
            isDraft
            commits(last:1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first:50) {
                      nodes {
                        __typename
                        ... on CheckRun {
                          name
                          conclusion
                          status
                          detailsUrl
                          checkSuite {
                            workflowRun {
                              workflow {
                                name
                              }
                            }
                          }
                        }
                        ... on StatusContext {
                          context
                          state
                          targetUrl
                        }
                      }
                    }
                  }
                }
              }
            }
            reviewThreads(first:50) {
              nodes {
                isResolved
                isOutdated
                comments(first:20) {
                  nodes {
                    body
                    url
                    createdAt
                    path
                    line
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${prNumber}`,
      ],
      { cwd: this.cwd },
    );

    const parsed = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            number: number;
            url: string;
            isDraft: boolean;
            commits?: {
              nodes?: Array<{
                commit?: {
                  statusCheckRollup?: {
                    contexts?: {
                      nodes?: Array<
                        | {
                            __typename: 'CheckRun';
                            name?: string;
                            conclusion?: string | null;
                            status?: string | null;
                            detailsUrl?: string | null;
                            checkSuite?: {
                              workflowRun?: { workflow?: { name?: string | null } | null } | null;
                            } | null;
                          }
                        | {
                            __typename: 'StatusContext';
                            context?: string;
                            state?: string | null;
                            targetUrl?: string | null;
                          }
                      >;
                    } | null;
                  } | null;
                } | null;
              }>;
            } | null;
            reviewThreads?: {
              nodes?: Array<{
                isResolved?: boolean;
                isOutdated?: boolean;
                comments?: {
                  nodes?: Array<{
                    body?: string;
                    url?: string;
                    createdAt?: string;
                    path?: string | null;
                    line?: number | null;
                    author?: { login?: string | null } | null;
                  }>;
                } | null;
              }>;
            } | null;
          } | null;
        } | null;
      };
    };

    const pr = parsed.data?.repository?.pullRequest;
    if (!pr) {
      throw new Error(`Pull request #${prNumber} not found`);
    }

    const failingChecks: GitHubPrCheckSummary[] = [];
    const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

    for (const node of contexts) {
      if (!node) continue;
      if (node.__typename === 'CheckRun') {
        const status = (node.status ?? '').toUpperCase();
        const conclusion = (node.conclusion ?? '').toUpperCase();
        const summary: GitHubPrCheckSummary = {
          name: node.name ?? 'check',
          status:
            status !== 'COMPLETED'
              ? 'pending'
              : conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED'
                ? 'success'
                : 'failed',
          conclusion: node.conclusion?.toLowerCase() ?? null,
          detailsUrl: node.detailsUrl ?? null,
          workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
        };
        if (summary.status === 'failed') failingChecks.push(summary);
        continue;
      }

      const state = (node.state ?? '').toUpperCase();
      const summary: GitHubPrCheckSummary = {
        name: node.context ?? 'status',
        status: state === 'SUCCESS' ? 'success' : state === 'PENDING' ? 'pending' : 'failed',
        conclusion: node.state?.toLowerCase() ?? null,
        detailsUrl: node.targetUrl ?? null,
        workflowName: null,
      };
      if (summary.status === 'failed') failingChecks.push(summary);
    }

    const unresolvedThreads = (pr.reviewThreads?.nodes ?? []).filter(
      (thread) => !thread?.isResolved && !thread?.isOutdated,
    );
    const unresolvedReviewComments: GitHubPrReviewCommentSummary[] = unresolvedThreads
      .map((thread) => {
        const comments = thread.comments?.nodes ?? [];
        const comment = comments[comments.length - 1];
        if (!comment?.url || !comment.body || !comment.createdAt) return null;
        return {
          author: comment.author?.login ?? null,
          body: comment.body,
          url: comment.url,
          createdAt: comment.createdAt,
          path: comment.path ?? null,
          line: comment.line ?? null,
        } satisfies GitHubPrReviewCommentSummary;
      })
      .filter((comment): comment is GitHubPrReviewCommentSummary => !!comment);

    return {
      number: pr.number,
      url: pr.url,
      isDraft: !!pr.isDraft,
      ciBlocked: failingChecks.length > 0,
      failingChecks,
      unresolvedReviewComments,
      unresolvedReviewCommentCount: unresolvedThreads.length,
    };
  }

  async getPullRequestDetail(prNumber: number): Promise<PullRequestDetail> {
    const { owner, repo } = await this.getRepoCoordinates();
    const query = `
      query($owner:String!, $repo:String!, $number:Int!) {
        repository(owner:$owner, name:$repo) {
          pullRequest(number:$number) {
            number
            url
            title
            body
            author { login }
            headRefName
            baseRefName
            isDraft
            state
            reviewDecision
            additions
            deletions
            changedFiles
            labels(first:20) { nodes { name } }
            closingIssuesReferences(first:10) { nodes { number } }
            commits(last:1) {
              nodes {
                commit {
                  statusCheckRollup {
                    contexts(first:50) {
                      nodes {
                        __typename
                        ... on CheckRun {
                          name
                          conclusion
                          status
                          detailsUrl
                          checkSuite {
                            workflowRun {
                              workflow {
                                name
                              }
                            }
                          }
                        }
                        ... on StatusContext {
                          context
                          state
                          targetUrl
                        }
                      }
                    }
                  }
                }
              }
            }
            reviewThreads(first:50) {
              nodes {
                isResolved
                isOutdated
                comments(first:20) {
                  nodes {
                    body
                    url
                    createdAt
                    path
                    line
                    author {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${prNumber}`,
      ],
      { cwd: this.cwd },
    );

    const parsed = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            number: number;
            url: string;
            title: string;
            body: string | null;
            author: { login: string } | null;
            headRefName: string;
            baseRefName: string;
            isDraft: boolean;
            state: string;
            reviewDecision: string | null;
            additions: number;
            deletions: number;
            changedFiles: number;
            labels?: { nodes?: Array<{ name?: string }> } | null;
            closingIssuesReferences?: { nodes?: Array<{ number?: number }> } | null;
            commits?: {
              nodes?: Array<{
                commit?: {
                  statusCheckRollup?: {
                    contexts?: {
                      nodes?: Array<
                        | {
                            __typename: 'CheckRun';
                            name?: string;
                            conclusion?: string | null;
                            status?: string | null;
                            detailsUrl?: string | null;
                            checkSuite?: {
                              workflowRun?: { workflow?: { name?: string | null } | null } | null;
                            } | null;
                          }
                        | {
                            __typename: 'StatusContext';
                            context?: string;
                            state?: string | null;
                            targetUrl?: string | null;
                          }
                      >;
                    } | null;
                  } | null;
                } | null;
              }>;
            } | null;
            reviewThreads?: {
              nodes?: Array<{
                isResolved?: boolean;
                isOutdated?: boolean;
                comments?: {
                  nodes?: Array<{
                    body?: string;
                    url?: string;
                    createdAt?: string;
                    path?: string | null;
                    line?: number | null;
                    author?: { login?: string | null } | null;
                  }>;
                } | null;
              }>;
            } | null;
          } | null;
        } | null;
      };
    };

    const pr = parsed.data?.repository?.pullRequest;
    if (!pr) {
      throw new Error(`Pull request #${prNumber} not found`);
    }

    const failingChecks: GitHubPrCheckSummary[] = [];
    const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

    for (const node of contexts) {
      if (!node) continue;
      if (node.__typename === 'CheckRun') {
        const status = (node.status ?? '').toUpperCase();
        const conclusion = (node.conclusion ?? '').toUpperCase();
        const summary: GitHubPrCheckSummary = {
          name: node.name ?? 'check',
          status:
            status !== 'COMPLETED'
              ? 'pending'
              : conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED'
                ? 'success'
                : 'failed',
          conclusion: node.conclusion?.toLowerCase() ?? null,
          detailsUrl: node.detailsUrl ?? null,
          workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
        };
        if (summary.status === 'failed') failingChecks.push(summary);
        continue;
      }

      const state = (node.state ?? '').toUpperCase();
      const summary: GitHubPrCheckSummary = {
        name: node.context ?? 'status',
        status: state === 'SUCCESS' ? 'success' : state === 'PENDING' ? 'pending' : 'failed',
        conclusion: node.state?.toLowerCase() ?? null,
        detailsUrl: node.targetUrl ?? null,
        workflowName: null,
      };
      if (summary.status === 'failed') failingChecks.push(summary);
    }

    const unresolvedThreads = (pr.reviewThreads?.nodes ?? []).filter(
      (thread) => !thread?.isResolved && !thread?.isOutdated,
    );
    const unresolvedReviewComments: GitHubPrReviewCommentSummary[] = unresolvedThreads
      .map((thread) => {
        const comments = thread.comments?.nodes ?? [];
        const comment = comments[comments.length - 1];
        if (!comment?.url || !comment.body || !comment.createdAt) return null;
        return {
          author: comment.author?.login ?? null,
          body: comment.body,
          url: comment.url,
          createdAt: comment.createdAt,
          path: comment.path ?? null,
          line: comment.line ?? null,
        } satisfies GitHubPrReviewCommentSummary;
      })
      .filter((comment): comment is GitHubPrReviewCommentSummary => !!comment);

    return {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      body: pr.body ?? null,
      author: pr.author?.login ?? null,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      isDraft: !!pr.isDraft,
      state: pr.state as PullRequestState,
      reviewDecision: (pr.reviewDecision as PullRequestReviewDecision) ?? null,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      labels: (pr.labels?.nodes ?? []).map((n) => n.name ?? '').filter(Boolean),
      linkedIssueNumbers: (pr.closingIssuesReferences?.nodes ?? [])
        .map((n) => n.number)
        .filter((n): n is number => typeof n === 'number'),
      ciBlocked: failingChecks.length > 0,
      failingChecks,
      unresolvedReviewComments,
      unresolvedReviewCommentCount: unresolvedThreads.length,
    };
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await this.spawnWithStdin(
      'gh',
      ['issue', 'comment', String(issueNumber), '--body-file', '-'],
      body,
    );
  }

  async listIssueComments(issueNumber: number): Promise<GitHubIssueComment[]> {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'comments'],
      { cwd: this.cwd },
    );
    const parsed = JSON.parse(stdout) as {
      comments: Array<{
        id: string;
        author: { login: string } | null;
        body: string;
        createdAt: string;
        url: string;
      }>;
    };
    return (parsed.comments ?? []).map((c) => ({
      id: Number(c.id),
      author: c.author?.login ?? null,
      body: c.body,
      createdAt: c.createdAt,
      url: c.url,
    }));
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await execFileAsync('gh', ['issue', 'close', String(issueNumber)], { cwd: this.cwd });
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    await execFileAsync('gh', ['issue', 'reopen', String(issueNumber)], { cwd: this.cwd });
  }

  /**
   * Archive a GitHub Projects v2 item for the given issue number.
   * Finds the item ID via GraphQL then calls archiveProjectV2Item mutation.
   * Idempotent — silently succeeds if the item is already archived.
   */
  /**
   * Archive all GitHub Projects v2 items linked to the given issue.
   * Queries the issue's own projectItems (no project URL needed) and
   * calls archiveProjectV2Item for each. Best-effort — caller should
   * catch/swallow failures.
   */
  async archiveProjectItems(issueNumber: number): Promise<void> {
    // Step 1: get owner/repo from the local git remote
    const { owner, repo } = await this.getRepoCoordinates();

    // Step 2: fetch all project items for this issue
    const itemQuery = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            projectItems(first: 10) {
              nodes { id project { id } }
            }
          }
        }
      }
    `;
    const { stdout: itemOut } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${itemQuery}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${issueNumber}`,
      ],
      { cwd: this.cwd },
    );
    const itemData = JSON.parse(itemOut) as {
      data: {
        repository: {
          issue: { projectItems: { nodes: Array<{ id: string; project: { id: string } }> } };
        };
      };
    };

    const items = itemData.data.repository?.issue?.projectItems?.nodes ?? [];
    if (items.length === 0) return;

    // Step 3: archive each item
    const archiveMutation = `
      mutation($projectId: ID!, $itemId: ID!) {
        archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          item { id }
        }
      }
    `;
    await Promise.all(
      items.map((item) =>
        execFileAsync(
          'gh',
          [
            'api',
            'graphql',
            '-f',
            `query=${archiveMutation}`,
            '-F',
            `projectId=${item.project.id}`,
            '-F',
            `itemId=${item.id}`,
          ],
          { cwd: this.cwd },
        ),
      ),
    );
  }

  async setStatusLabel(issueNumber: number, label: GitHubStatusLabel): Promise<void> {
    // Remove all existing status:* labels first
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['issue', 'view', String(issueNumber), '--json', 'labels'],
        { cwd: this.cwd },
      );
      const { labels } = JSON.parse(stdout) as { labels: Array<{ name: string }> };
      const statusLabels = (labels ?? []).map((l) => l.name).filter((n) => n.startsWith('status:'));

      for (const old of statusLabels) {
        try {
          await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--remove-label', old], {
            cwd: this.cwd,
          });
        } catch {
          // Label removal is best-effort
        }
      }
    } catch {
      // Issue fetch is best-effort
    }

    // Add new label
    try {
      await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], {
        cwd: this.cwd,
      });
    } catch {
      // Label addition is best-effort
    }
  }

  async getRepoSlug(): Promise<string> {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      { cwd: this.cwd },
    );
    return stdout.trim();
  }
}
