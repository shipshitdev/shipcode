import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextFileInfo, ContextGeneratorCli } from '@shipcode/shared';
import { extractCliFailureMessage } from './cli-error';
import { shellExecEnv } from './health-check';

const MEMORY_DIR = '.agents/memory';
const MEMORY_FENCE_TAG = 'shipcode-memory';

const GENERATED_MEMORY_FILES = [
  {
    key: 'goal',
    name: 'goal.md',
    memoryName: 'repo_goal',
    description: 'Project purpose, users, value, and intended outcomes.',
    topics: ['goal', 'product'],
  },
  {
    key: 'architecture',
    name: 'architecture.md',
    memoryName: 'repo_architecture',
    description: 'System shape, stack, boundaries, modules, and data flow.',
    topics: ['architecture', 'stack'],
  },
  {
    key: 'constraints',
    name: 'constraints.md',
    memoryName: 'repo_constraints',
    description: 'Constraints, conventions, tests, and non-negotiable guardrails.',
    topics: ['constraints', 'conventions'],
  },
  {
    key: 'doDont',
    name: 'do-dont.md',
    memoryName: 'repo_do_dont',
    description: 'Concrete do and do-not guidance for agents working in this repo.',
    topics: ['workflow', 'rules'],
  },
] as const;

type GeneratedMemoryFile = (typeof GENERATED_MEMORY_FILES)[number];

export interface ContextGenerateResult {
  success: boolean;
  error?: string;
  /** Which files were actually written (a subset if partial failure). */
  written: string[];
}

function isCliResultEnvelope(value: unknown): value is { result: string } {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { result?: unknown }).result === 'string'
  );
}

/**
 * List the generated repo memory files for a project, reporting existence and
 * size.
 */
export function listContextFiles(projectPath: string): ContextFileInfo[] {
  return GENERATED_MEMORY_FILES.map((file) => {
    try {
      const stat = statSync(join(projectPath, MEMORY_DIR, file.name));
      return {
        name: file.name,
        exists: true,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      return { name: file.name, exists: false };
    }
  });
}

/**
 * Read one of the generated repo memory files.
 * Returns null if the file is missing or unreadable.
 * Validates the name to prevent path traversal.
 */
export function readContextFile(projectPath: string, name: string): string | null {
  if (!GENERATED_MEMORY_FILES.some((entry) => entry.name === name)) {
    return null;
  }
  try {
    return readFileSync(join(projectPath, MEMORY_DIR, name), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Use the selected CLI to generate the canonical repo memory files from the
 * target repo's README, package.json, AGENTS.md, and CLAUDE.md. Writes
 * results to `<projectPath>/.agents/memory/`.
 *
 * The prompt is piped via stdin — never passed as argv — to avoid
 * Claude CLI's argparser rejecting YAML frontmatter (`---`) as a flag.
 */
export async function generateContextFiles(
  projectPath: string,
  cli: ContextGeneratorCli = 'claude',
): Promise<ContextGenerateResult> {
  const readSource = (filename: string): string | null => {
    try {
      return readFileSync(join(projectPath, filename), 'utf8');
    } catch {
      return null;
    }
  };

  const readmeContent = readSource('README.md');
  const packageJsonContent = readSource('package.json');
  const agentsMdContent = readSource('AGENTS.md');
  const claudeMdContent = readSource('CLAUDE.md');

  const prompt = buildMemoryPrompt(
    readmeContent,
    packageJsonContent,
    agentsMdContent,
    claudeMdContent,
  );

  let stdout: string;
  try {
    stdout = await runContextCliWithStdin(cli, prompt, projectPath, 180_000);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      written: [],
    };
  }

  // `claude -p --output-format json` returns `{ session_id, result, ... }`.
  // Unwrap to `result`, with a raw-stdout fallback for older CLI versions.
  let text = stdout;
  try {
    const envelope = JSON.parse(stdout) as unknown;
    if (isCliResultEnvelope(envelope)) {
      text = envelope.result;
    }
  } catch {
    // not a JSON envelope — use raw stdout
  }

  let files: Record<string, string>;
  try {
    files = extractGeneratedMemoryFiles(text);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      written: [],
    };
  }

  const memoryDir = join(projectPath, MEMORY_DIR);
  mkdirSync(memoryDir, { recursive: true });

  const written: string[] = [];
  for (const file of GENERATED_MEMORY_FILES) {
    try {
      writeFileSync(
        join(memoryDir, file.name),
        wrapGeneratedMemoryFile(file, files[file.key]),
        'utf8',
      );
      written.push(file.name);
    } catch {
      // continue — partial writes are reported via `written`
    }
  }

  return {
    success: written.length === GENERATED_MEMORY_FILES.length,
    written,
    error:
      written.length < GENERATED_MEMORY_FILES.length
        ? `Only wrote ${written.length}/${GENERATED_MEMORY_FILES.length} memory files`
        : undefined,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function buildMemoryPrompt(
  readmeContent: string | null,
  packageJsonContent: string | null,
  agentsMdContent: string | null,
  claudeMdContent: string | null,
): string {
  return `You are analyzing a software repository to generate repo memory files for an AI coding pipeline.

## Source material

### README.md
${readmeContent ?? '(not found)'}

### package.json
${packageJsonContent ?? '(not found)'}

### AGENTS.md
${agentsMdContent ?? '(not found)'}

### CLAUDE.md
${claudeMdContent ?? '(not found)'}

## Your task

Generate exactly 4 concise repo memory documents (40–160 lines each):

1. **goal.md** — Project purpose, target users, core value proposition, and what success looks like.
2. **architecture.md** — Architecture AND tech stack together: runtimes, frameworks, directory layout, key modules, boundaries, and data flow.
3. **constraints.md** — Coding conventions, style rules, testing requirements, safety constraints, and anti-patterns.
4. **do-dont.md** — Concrete "do this / don't do this" operating guidance for agents working in this repo.

Treat AGENTS.md as a source of repo-specific conventions and constraints. Ignore global user-profile or account-level guidance that is not about the repository itself.

## Output contract

Output exactly one fenced block tagged \`shipcode-memory\` containing a JSON object with keys
\`goal\`, \`architecture\`, \`constraints\`, \`doDont\`. Each value must be markdown BODY CONTENT ONLY
with no YAML frontmatter. Encode newlines as \\n and quotes as \\".

\`\`\`shipcode-memory
{"goal":"...","architecture":"...","constraints":"...","doDont":"..."}
\`\`\`
`;
}

/**
 * Extract and validate the `shipcode-memory` fenced block from a text blob.
 * Uses line-by-line parsing to avoid false-matching on embedded backtick sequences.
 */
function extractGeneratedMemoryFiles(text: string): Record<string, string> {
  const openTag = `\`\`\`${MEMORY_FENCE_TAG}`;
  const lines = text.split('\n');
  let collecting = false;
  const captured: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (trimmed === openTag || trimmed.startsWith(`${openTag} `)) {
        collecting = true;
      }
      continue;
    }
    if (trimmed === '```') break;
    captured.push(line);
  }

  if (!captured.length) {
    throw new Error(`No \`${MEMORY_FENCE_TAG}\` fenced block found in AI response`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.join('\n').trim());
  } catch (err) {
    throw new Error(
      `Failed to parse memory JSON inside \`${MEMORY_FENCE_TAG}\` block: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  for (const key of ['goal', 'architecture', 'constraints', 'doDont']) {
    if (
      !parsed ||
      typeof (parsed as Record<string, unknown>)[key] !== 'string' ||
      !(parsed as Record<string, string>)[key].trim()
    ) {
      throw new Error(`Memory JSON is missing or has empty \`${key}\` key`);
    }
  }

  return parsed as Record<string, string>;
}

function wrapGeneratedMemoryFile(file: GeneratedMemoryFile, content: string): string {
  const normalized = content.trim().replace(/\r\n/g, '\n');
  const topics = file.topics.join(', ');
  const lastVerified = new Date().toISOString().slice(0, 10);

  return `---
name: ${file.memoryName}
description: ${file.description}
type: project
status: active
last_verified: ${lastVerified}
topics: [${topics}]
---

${normalized}
`;
}

/**
 * Spawn the selected context-generator CLI and pipe the prompt through stdin.
 * Claude requires stdin to avoid argparser issues with frontmatter. Codex
 * supports stdin via `exec -`, which keeps the prompt path symmetric.
 */
function runContextCliWithStdin(
  cli: ContextGeneratorCli,
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = cli;
    const label = cli === 'claude' ? 'Claude CLI' : 'Codex CLI';
    const args =
      cli === 'claude'
        ? [
            '-p',
            '--output-format',
            'json',
            '--max-turns',
            '1',
            '--dangerously-skip-permissions',
            '--disallowedTools',
            'Edit,Write,Bash,NotebookEdit',
          ]
        : [
            '-a',
            'never',
            '-c',
            'model_reasoning_effort=high',
            'exec',
            '-',
            '--sandbox',
            'read-only',
          ];
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: shellExecEnv(),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${label} spawn failed: ${err.message.split('\n')[0].slice(0, 200)}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const tidy = extractCliFailureMessage(stdout, stderr);
      reject(new Error(`${label} exited ${code}: ${tidy}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
