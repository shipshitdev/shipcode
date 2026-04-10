import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubIssue, GitHubStatusLabel } from '@shipcode/shared';

const execFileAsync = promisify(execFile);

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
        'open',
        '--json',
        'number,title,body,labels,assignees,state,url',
        '--limit',
        '100',
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
