import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  checkClaudeAuth,
  checkCodexAuth,
  checkOpenRouterAuth,
  checkSystemHealth,
  parseGhProjectScope,
} from '@shipcode/agents';
import { getDatabase, ProjectQueries } from '@shipcode/db';
import { GitService } from '@shipcode/git';
import { type GitHubLabelDefinition, SHIPCODE_DEFAULT_LABELS } from '@shipcode/shared';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

async function listGithubLabelNames(cwd: string): Promise<string[]> {
  const { stdout } = await execAsync('gh label list --json name -q ".[].name"', {
    cwd,
    timeout: 10_000,
  });
  return stdout
    .trim()
    .split('\n')
    .map((label) => label.trim())
    .filter(Boolean);
}

async function createGithubLabel(
  cwd: string,
  label: { name: string; color: string; description: string },
): Promise<void> {
  await execFileAsync(
    'gh',
    ['label', 'create', label.name, '--color', label.color, '--description', label.description],
    { cwd, timeout: 10_000 },
  );
}

export async function onboardCommand() {
  const cwd = process.cwd();
  console.log('ShipCode Onboarding\n');

  // 1. Prerequisite validation
  console.log('Checking prerequisites...');
  const health = await checkSystemHealth();

  const failures: string[] = [];
  if (!health.git.available) failures.push('git is not installed');
  if (!health.gh.available) failures.push('gh (GitHub CLI) is not installed');
  if (!health.claude.available) failures.push('claude CLI is not installed');
  if (!health.codex.available) failures.push('codex CLI is not installed');

  if (failures.length > 0) {
    console.error('\n✗ Missing prerequisites:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('  ✓ git, gh, claude, codex — all available');

  // Auth checks
  try {
    const { stdout, stderr } = await execAsync('gh auth status 2>&1', { timeout: 10_000 });
    const output = (stdout ?? '') + (stderr ?? '');
    const hasProjectScope = parseGhProjectScope(output);
    if (hasProjectScope === true) {
      console.log('  ✓ gh — authenticated (project scope ok)');
    } else if (hasProjectScope === false) {
      console.log('  ✓ gh — authenticated');
      console.log(
        '  ⚠ gh missing `project` scope — Projects v2 board attach will fail.\n' +
          '    Fix: gh auth refresh -s project',
      );
    } else {
      // Older gh versions don't print a Token scopes line; skip the warning
      console.log('  ✓ gh — authenticated');
    }
  } catch {
    console.error('\n✗ gh is not authenticated. Run: gh auth login');
    process.exit(1);
  }

  const claudeAuth = await checkClaudeAuth();
  if (claudeAuth) {
    console.log('  ✓ claude — authenticated');
  } else {
    console.error('\n✗ claude is not authenticated. Check your API key or run: claude auth');
    process.exit(1);
  }

  const codexAuth = await checkCodexAuth();
  if (codexAuth) {
    console.log('  ✓ codex — authenticated');
  } else {
    console.log(
      '  ⚠ codex — not authenticated (adversarial review will be skipped). Run: codex login',
    );
  }

  // OpenRouter is optional. A missing key is a warning, not a failure,
  // because the pipeline still works with claude/codex alone.
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    const orAuth = await checkOpenRouterAuth(openrouterKey);
    if (orAuth.ok) {
      console.log(`  ✓ openrouter — authenticated${orAuth.label ? ` (${orAuth.label})` : ''}`);
    } else if (orAuth.reason === 'invalid_key') {
      console.log(`  ⚠ openrouter — ${orAuth.message}`);
    } else if (orAuth.reason === 'unreachable') {
      console.log(`  ⚠ openrouter — ${orAuth.message}`);
    } else if (orAuth.reason === 'model_deprecated') {
      console.log(`  ⚠ openrouter — ${orAuth.message}`);
    }
  } else {
    console.log('  ⚠ openrouter — OPENROUTER_API_KEY not set (optional)');
  }

  // 2. Repo context verification
  console.log('\nVerifying GitHub repository...');
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd, timeout: 5_000 });
  } catch {
    console.error('✗ Not inside a git repository');
    process.exit(1);
  }

  let repoSlug: string;
  try {
    const { stdout } = await execAsync('gh repo view --json nameWithOwner -q .nameWithOwner', {
      cwd,
      timeout: 10_000,
    });
    repoSlug = stdout.trim();
    console.log(`  ✓ GitHub repo: ${repoSlug}`);
  } catch {
    console.error('✗ Not a GitHub repository or gh cannot resolve repo context');
    process.exit(1);
  }

  // 3. Database bootstrap
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);

  // 4. Git info detection
  const gitService = new GitService(cwd);
  const gitRemote = await gitService.getRemoteUrl();
  const defaultBranch = await gitService.getDefaultBranch();
  console.log(`  ✓ Remote: ${gitRemote ?? 'none'}`);
  console.log(`  ✓ Default branch: ${defaultBranch}`);

  // 5. Project registration
  let project = projects.list().find((p) => p.path === cwd);
  if (!project) {
    project = projects.add(cwd);
    console.log('\n  ✓ Project registered');
  } else {
    console.log('\n  ✓ Project already registered');
  }
  projects.updateGitInfo(project.id, gitRemote, defaultBranch);

  // 6. Label verification
  console.log('\nChecking GitHub labels...');
  try {
    const existingLabels = await listGithubLabelNames(cwd);
    const missing = SHIPCODE_DEFAULT_LABELS.filter(
      (label: GitHubLabelDefinition) => !existingLabels.includes(label.name),
    );
    if (missing.length > 0) {
      const created: string[] = [];
      const failed: string[] = [];

      for (const label of missing) {
        try {
          await createGithubLabel(cwd, label);
          created.push(label.name);
        } catch (err) {
          const message = err instanceof Error ? err.message.split('\n')[0] : 'unknown error';
          failed.push(`${label.name} (${message})`);
        }
      }

      if (created.length > 0) {
        console.log(`  ✓ Created labels: ${created.join(', ')}`);
      }
      if (failed.length > 0) {
        console.log(`  ⚠ Failed to create labels: ${failed.join(', ')}`);
      }
      if (existingLabels.length > 0) {
        console.log(`  ✓ Existing labels kept: ${existingLabels.length}`);
      }
    } else {
      console.log('  ✓ All ShipCode labels present');
    }
  } catch {
    console.log('  ⚠ Could not check labels');
  }

  // 7. Summary
  console.log('\n─────────────────────────────');
  console.log('ShipCode is ready!');
  console.log(`  Repo:     ${repoSlug}`);
  console.log(`  Remote:   ${gitRemote ?? 'none'}`);
  console.log(`  Branch:   ${defaultBranch}`);
  console.log(`  Data:     ${dataDir}`);
  console.log('\nNext step:');
  console.log('  shipcode run <issue-number>');
  console.log('─────────────────────────────\n');
}
