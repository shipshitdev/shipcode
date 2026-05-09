import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type GitHubIssue,
  type GitHubIssueComment,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  isAgentRoutingLabel,
  LEGACY_AGENT_LABELS,
  PRD_MANAGED_DISCRETE_LABELS,
  PRD_MANAGED_LABEL_PREFIXES,
  type PullRequestDetail,
  type PullRequestListFilter,
  type PullRequestListItem,
  type PullRequestReviewDecision,
  type PullRequestState,
  parseGithubProjectUrl,
  SHIPCODE_AGENT_LABELS,
} from '@shipcode/shared';
import { shellExecEnv } from '../health-check';

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

function normalizeProjectFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatMetadataOption(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join('-');
}

function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function getGraphqlErrors(response: { errors?: Array<{ message?: string }> }): string | null {
  if (!response.errors || response.errors.length === 0) return null;
  return response.errors.map((err) => err.message ?? '<unknown>').join('; ');
}

export interface PullRequestFeedback {
  number: number;
  url: string;
  isDraft: boolean;
  state: PullRequestState;
  reviewDecision: PullRequestReviewDecision | null;
  reviewRequestCount: number;
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
}

export interface IssueProjectMetadata {
  issueType?: string;
  status?: string;
  priority?: string;
  complexity?: string;
  blastRadius?: string;
}

export interface IssueLabelActions {
  addLabels?: string[];
  removeLabels?: string[];
}

export interface IssueLabelActionResult {
  added: string[];
  removed: string[];
  skipped: string[];
}

interface ProjectMetadataQueryResponse {
  data?: {
    repository?: {
      issue?: {
        id?: string;
        projectItems?: {
          nodes?: Array<{
            id?: string;
            project?: { id?: string; number?: number };
          }>;
        };
      } | null;
      issueType?: { id?: string; isEnabled?: boolean } | null;
    } | null;
    organization?: ProjectOwnerNode | null;
    user?: ProjectOwnerNode | null;
  };
  errors?: Array<{ message?: string }>;
}

interface ProjectOwnerNode {
  projectV2?: {
    id?: string;
    fields?: {
      nodes?: Array<{
        __typename?: string;
        id?: string;
        name?: string;
        options?: Array<{ id?: string; name?: string }>;
      }>;
    };
  } | null;
}

export class GhCli {
  private env: Record<string, string>;

  constructor(private cwd: string) {
    this.env = shellExecEnv();
  }

  async getRepoMetadata(): Promise<{ githubRepoId: string; githubRepoFullName: string }> {
    const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'id,nameWithOwner'], {
      cwd: this.cwd,
      env: this.env,
    });
    const parsed = JSON.parse(stdout) as { id?: string; nameWithOwner?: string };
    const githubRepoId = parsed.id?.trim();
    const githubRepoFullName = parsed.nameWithOwner?.trim();
    if (!githubRepoId || !githubRepoFullName) {
      throw new Error('Failed to resolve repository id/name via gh repo view');
    }
    return { githubRepoId, githubRepoFullName };
  }

  private async getRepoCoordinates(): Promise<{ owner: string; repo: string }> {
    const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], {
      cwd: this.cwd,
      env: this.env,
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
      { cwd: this.cwd, env: this.env },
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
      { cwd: this.cwd, env: this.env },
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
        { cwd: this.cwd, env: this.env },
      );
    } catch (err) {
      const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message);
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
        /* v8 ignore next -- createLabel rejects Error instances in normal CLI execution */
        failed.push({ name: label.name, error: String(err instanceof Error ? err.message : err) });
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

  async syncIssueLabels(
    issueNumber: number,
    labels: string[],
    options?: { removeAgentLabels?: boolean },
  ): Promise<void> {
    const next = await this.filterExistingLabels(labels);
    let current: string[] = [];

    try {
      const issue = await this.getIssue(issueNumber);
      current = issue.labels;
    } catch {
      current = [];
    }

    const toRemove = current.filter((label) => {
      const managed =
        this.isManagedPrdLabel(label) ||
        (!!options?.removeAgentLabels && isAgentRoutingLabel(label));
      return managed && !next.includes(label);
    });
    const toAdd = next.filter((label) => !current.includes(label));

    for (const label of toRemove) {
      try {
        await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--remove-label', label], {
          cwd: this.cwd,
          env: this.env,
        });
      } catch {
        // Removal is best-effort.
      }
    }

    for (const label of toAdd) {
      try {
        await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], {
          cwd: this.cwd,
          env: this.env,
        });
      } catch {
        // Addition is best-effort.
      }
    }
  }

  async applyIssueLabelActions(
    issueNumber: number,
    actions: IssueLabelActions,
  ): Promise<IssueLabelActionResult> {
    const addLabels = uniqueLabels(actions.addLabels ?? []);
    const removeLabels = uniqueLabels(actions.removeLabels ?? []);
    const availableAdds = await this.filterExistingLabels(addLabels);
    const availableAddSet = new Set(availableAdds);
    const skipped = addLabels.filter((label) => !availableAddSet.has(label));
    const issue = await this.getIssue(issueNumber);
    const current = new Set(issue.labels);
    const added: string[] = [];
    const removed: string[] = [];

    for (const label of availableAdds) {
      if (current.has(label)) continue;
      await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--add-label', label], {
        cwd: this.cwd,
        env: this.env,
      });
      current.add(label);
      added.push(label);
    }

    for (const label of removeLabels) {
      if (!current.has(label)) continue;
      await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--remove-label', label], {
        cwd: this.cwd,
        env: this.env,
      });
      current.delete(label);
      removed.push(label);
    }

    return { added, removed, skipped };
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
      { cwd: this.cwd, env: this.env },
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
        'number,title,body,labels,assignees,author,state,url,updatedAt',
        '--limit',
        '200',
      ],
      { cwd: this.cwd, env: this.env },
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
      ...((r.updatedAt as string | undefined) ? { updatedAt: r.updatedAt as string } : {}),
      author: (r.author as { login?: string } | null)?.login
        ? { login: (r.author as { login: string }).login }
        : undefined,
    }));
  }

  async listAllAgentIssues(): Promise<GitHubIssue[]> {
    const labels = [...SHIPCODE_AGENT_LABELS.map((label) => label.name), ...LEGACY_AGENT_LABELS];
    const buckets = await Promise.all(
      labels.map((label) => this.listIssues(label).catch(() => [])),
    );
    // Deduplicate by issue number
    const seen = new Set<number>();
    const merged: GitHubIssue[] = [];
    for (const issue of buckets.flat()) {
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
      { cwd: this.cwd, env: this.env },
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
        { cwd: this.cwd, env: this.env },
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

  async setIssueProjectMetadata(opts: {
    issueNumber: number;
    projectUrl: string | null | undefined;
    metadata: IssueProjectMetadata;
  }): Promise<string[]> {
    const warnings: string[] = [];
    const parsedProject = parseGithubProjectUrl(opts.projectUrl);
    if (!parsedProject) return warnings;

    const { owner: repoOwner, repo: repoName } = await this.getRepoCoordinates();
    const isOrgProject = parsedProject.ownerType === 'orgs';
    const projectSelection = isOrgProject
      ? 'organization(login: $projectOwner) { projectV2(number: $projectNumber) { id fields(first: 100) { nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name } } } } } }'
      : 'user(login: $projectOwner) { projectV2(number: $projectNumber) { id fields(first: 100) { nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name } } } } } }';
    const query = `
      query(
        $repoOwner: String!
        $repoName: String!
        $issueNumber: Int!
        $issueType: String!
        $projectOwner: String!
        $projectNumber: Int!
      ) {
        repository(owner: $repoOwner, name: $repoName) {
          issue(number: $issueNumber) {
            id
            projectItems(first: 100) {
              nodes {
                id
                project { id number }
              }
            }
          }
          issueType(name: $issueType) { id isEnabled }
        }
        ${projectSelection}
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
        `repoOwner=${repoOwner}`,
        '-F',
        `repoName=${repoName}`,
        '-F',
        `issueNumber=${opts.issueNumber}`,
        '-F',
        `issueType=${opts.metadata.issueType ?? ''}`,
        '-F',
        `projectOwner=${parsedProject.owner}`,
        '-F',
        `projectNumber=${parsedProject.number}`,
      ],
      { cwd: this.cwd, env: this.env },
    );
    const response = JSON.parse(stdout) as ProjectMetadataQueryResponse;
    const queryErrors = getGraphqlErrors(response);
    if (queryErrors) throw new Error(`GitHub project metadata query failed: ${queryErrors}`);

    const issue = response.data?.repository?.issue;
    const project = isOrgProject
      ? response.data?.organization?.projectV2
      : response.data?.user?.projectV2;
    const issueId = issue?.id;
    const projectId = project?.id;
    if (!issueId || !projectId) return warnings;

    const itemId =
      issue.projectItems?.nodes?.find((item) => item.project?.id === projectId)?.id ?? null;
    if (!itemId) {
      warnings.push(`#${opts.issueNumber}: issue is not attached to the configured project`);
      return warnings;
    }

    if (opts.metadata.issueType) {
      const issueType = response.data?.repository?.issueType;
      if (issueType?.id && issueType.isEnabled !== false) {
        await this.graphqlMutation(
          `
          mutation($issueId: ID!, $issueTypeId: ID!) {
            updateIssueIssueType(input: { issueId: $issueId, issueTypeId: $issueTypeId }) {
              issue { id }
            }
          }
        `,
          [
            ['issueId', issueId],
            ['issueTypeId', issueType.id],
          ],
        );
      } else {
        warnings.push(`#${opts.issueNumber}: issue type "${opts.metadata.issueType}" not found`);
      }
    }

    const fieldValues: Array<[fieldName: string, optionName: string | undefined]> = [
      ['Status', opts.metadata.status],
      ['Priority', opts.metadata.priority],
      ['Complexity', opts.metadata.complexity],
      ['Blast radius', opts.metadata.blastRadius],
    ];
    const fields = project.fields?.nodes ?? [];

    for (const [fieldName, optionName] of fieldValues) {
      if (!optionName) continue;
      const field = fields.find(
        (candidate) =>
          candidate.__typename === 'ProjectV2SingleSelectField' &&
          normalizeProjectFieldKey(candidate.name as string) ===
            normalizeProjectFieldKey(fieldName),
      );
      if (!field?.id) {
        warnings.push(`#${opts.issueNumber}: project field "${fieldName}" not found`);
        continue;
      }

      const formattedOption =
        fieldName === 'Priority' ? optionName.toUpperCase() : formatMetadataOption(optionName);
      const option = field.options?.find(
        (candidate) =>
          normalizeProjectFieldKey(candidate.name as string) ===
          normalizeProjectFieldKey(formattedOption),
      );
      if (!option?.id) {
        warnings.push(
          `#${opts.issueNumber}: option "${formattedOption}" missing for "${fieldName}"`,
        );
        continue;
      }

      await this.graphqlMutation(
        `
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $projectId
              itemId: $itemId
              fieldId: $fieldId
              value: { singleSelectOptionId: $optionId }
            }
          ) {
            projectV2Item { id }
          }
        }
      `,
        [
          ['projectId', projectId],
          ['itemId', itemId],
          ['fieldId', field.id],
          ['optionId', option.id],
        ],
      );
    }

    return warnings;
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
      const proc = spawn(command, args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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

  private async graphqlMutation(query: string, variables: Array<[string, string]>): Promise<void> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of variables) {
      args.push('-F', `${key}=${value}`);
    }
    const { stdout } = await execFileAsync('gh', args, { cwd: this.cwd, env: this.env });
    const parsed = JSON.parse(stdout) as { errors?: Array<{ message?: string }> };
    const errors = getGraphqlErrors(parsed);
    if (errors) throw new Error(`GitHub GraphQL mutation failed: ${errors}`);
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

    const { stdout } = await execFileAsync('gh', args, { cwd: this.cwd, env: this.env });
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
      { cwd: this.cwd, env: this.env },
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
      { cwd: this.cwd, env: this.env },
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
        { cwd: this.cwd, env: this.env },
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
            state
            reviewDecision
            reviewRequests(first:50) {
              totalCount
            }
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
      { cwd: this.cwd, env: this.env },
    );

    const parsed = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            number: number;
            url: string;
            isDraft: boolean;
            state: string;
            reviewDecision: string | null;
            reviewRequests?: { totalCount?: number | null } | null;
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
      (thread) => !!thread && !thread.isResolved && !thread.isOutdated,
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
      state: pr.state as PullRequestState,
      reviewDecision: (pr.reviewDecision as PullRequestReviewDecision) ?? null,
      reviewRequestCount: pr.reviewRequests?.totalCount ?? 0,
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
      { cwd: this.cwd, env: this.env },
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
      (thread) => !!thread && !thread.isResolved && !thread.isOutdated,
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

  async editIssueComment(commentId: number, body: string): Promise<void> {
    const { owner, repo } = await this.getRepoCoordinates();
    await this.spawnWithStdin(
      'gh',
      [
        'api',
        '-X',
        'PATCH',
        `repos/${owner}/${repo}/issues/comments/${commentId}`,
        '-H',
        'Content-Type: application/json',
        '--input',
        '-',
      ],
      JSON.stringify({ body }),
    );
  }

  async upsertIssueCommentByMarker(
    issueNumber: number,
    marker: string,
    body: string,
  ): Promise<void> {
    const comments = await this.listIssueComments(issueNumber);
    const existing = comments.find((comment) => comment.body.trimStart().startsWith(marker));
    if (existing && Number.isFinite(existing.id)) {
      await this.editIssueComment(existing.id, body);
      return;
    }
    await this.addIssueComment(issueNumber, body);
  }

  async listIssueComments(issueNumber: number): Promise<GitHubIssueComment[]> {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'comments'],
      { cwd: this.cwd, env: this.env },
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
      id: parseIssueCommentDatabaseId(c.id, c.url),
      author: c.author?.login ?? null,
      body: c.body,
      createdAt: c.createdAt,
      url: c.url,
    }));
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await execFileAsync('gh', ['issue', 'close', String(issueNumber)], {
      cwd: this.cwd,
      env: this.env,
    });
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    await execFileAsync('gh', ['issue', 'reopen', String(issueNumber)], {
      cwd: this.cwd,
      env: this.env,
    });
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
      { cwd: this.cwd, env: this.env },
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
          { cwd: this.cwd, env: this.env },
        ),
      ),
    );
  }

  async getRepoSlug(): Promise<string> {
    const { stdout } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      { cwd: this.cwd, env: this.env },
    );
    return stdout.trim();
  }
}

function parseIssueCommentDatabaseId(id: string, url: string): number {
  const numericId = Number(id);
  if (Number.isFinite(numericId)) return numericId;

  const match = url.match(/issuecomment-(\d+)/);
  if (match?.[1]) {
    const urlId = Number(match[1]);
    /* v8 ignore next -- regex captures only decimal digits */
    if (Number.isFinite(urlId)) return urlId;
  }

  return Number.NaN;
}
