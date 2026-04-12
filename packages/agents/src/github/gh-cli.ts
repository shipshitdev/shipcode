import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubIssue, GitHubStatusLabel } from '@shipcode/shared';

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

export class GhCli {
  constructor(private cwd: string) {}

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
        'number,title,body,labels,assignees,state,url',
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
        'number,title,body,labels,assignees,state,url',
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
      ['issue', 'view', String(number), '--json', 'number,title,body,labels,assignees,state,url'],
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
    if (options.labels?.length) args.push('--label', options.labels.join(','));

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

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    await execFileAsync('gh', ['issue', 'comment', String(issueNumber), '--body', body], {
      cwd: this.cwd,
    });
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await execFileAsync('gh', ['issue', 'close', String(issueNumber)], { cwd: this.cwd });
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
    const { stdout: repoOut } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'owner,name'],
      { cwd: this.cwd },
    );
    const { owner, name: repo } = JSON.parse(repoOut) as { owner: { login: string }; name: string };

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
      ['api', 'graphql', '-f', `query=${itemQuery}`, '-F', `owner=${owner.login}`, '-F', `repo=${repo}`, '-F', `number=${issueNumber}`],
      { cwd: this.cwd },
    );
    const itemData = JSON.parse(itemOut) as {
      data: { repository: { issue: { projectItems: { nodes: Array<{ id: string; project: { id: string } }> } } } };
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
          ['api', 'graphql', '-f', `query=${archiveMutation}`, '-F', `projectId=${item.project.id}`, '-F', `itemId=${item.id}`],
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
