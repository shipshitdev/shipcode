import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextFileInfo } from '@shipcode/shared';

const CONTEXT_DIR = '.agents/context';
const CONTEXT_FENCE_TAG = 'shipcode-context';

const CONTEXT_FILE_NAMES = [
  'GOAL.md',
  'TECH-STACK.md',
  'ARCHITECTURE.md',
  'CONSTRAINTS.md',
] as const;

type ContextGeneratorCli = 'claude' | 'codex';

export interface ContextGenerateResult {
  success: boolean;
  error?: string;
  /** Which files were actually written (a subset if partial failure). */
  written: string[];
}

/**
 * List the 4 known context files for a project, reporting existence and size.
 * Never throws — per-file errors return `exists: false`.
 */
export function listContextFiles(projectPath: string): ContextFileInfo[] {
  return CONTEXT_FILE_NAMES.map((name) => {
    try {
      const stat = statSync(join(projectPath, CONTEXT_DIR, name));
      return {
        name,
        exists: true,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      return { name, exists: false };
    }
  });
}

/**
 * Read one of the 4 known context files.
 * Returns null if the file is missing or unreadable.
 * Validates the name to prevent path traversal.
 */
export function readContextFile(projectPath: string, name: string): string | null {
  if (!(CONTEXT_FILE_NAMES as readonly string[]).includes(name)) {
    return null;
  }
  try {
    return readFileSync(join(projectPath, CONTEXT_DIR, name), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Use Claude CLI to generate all 4 context files from the target repo's
 * README, package.json, and CLAUDE.md. Writes results to
 * `<projectPath>/.agents/context/`.
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
  const claudeMdContent = readSource('CLAUDE.md');

  const prompt = buildContextPrompt(readmeContent, packageJsonContent, claudeMdContent);

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
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    if (envelope && typeof envelope.result === 'string') {
      text = envelope.result;
    }
  } catch {
    // not a JSON envelope — use raw stdout
  }

  let files: Record<string, string>;
  try {
    files = extractContextFiles(text);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      written: [],
    };
  }

  const contextDir = join(projectPath, CONTEXT_DIR);
  mkdirSync(contextDir, { recursive: true });

  const written: string[] = [];
  const keyToFilename: Record<string, string> = {
    goal: 'GOAL.md',
    techStack: 'TECH-STACK.md',
    architecture: 'ARCHITECTURE.md',
    constraints: 'CONSTRAINTS.md',
  };

  for (const [key, filename] of Object.entries(keyToFilename)) {
    try {
      writeFileSync(join(contextDir, filename), files[key], 'utf8');
      written.push(filename);
    } catch {
      // continue — partial writes are reported via `written`
    }
  }

  return {
    success: written.length === 4,
    written,
    error: written.length < 4 ? `Only wrote ${written.length}/4 context files` : undefined,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function buildContextPrompt(
  readmeContent: string | null,
  packageJsonContent: string | null,
  claudeMdContent: string | null,
): string {
  return `You are analyzing a software repository to generate context files for an AI coding pipeline.

## Source material

### README.md
${readmeContent ?? '(not found)'}

### package.json
${packageJsonContent ?? '(not found)'}

### CLAUDE.md
${claudeMdContent ?? '(not found)'}

## Your task

Generate exactly 4 concise context documents (50–200 lines each):

1. **GOAL.md** — Project purpose, target users, core value proposition.
2. **TECH-STACK.md** — Languages, frameworks, runtimes, key deps, build tools.
3. **ARCHITECTURE.md** — Directory layout, key modules, data flow, component interactions.
4. **CONSTRAINTS.md** — Coding conventions, style rules, testing requirements, anti-patterns.

## Output contract

Output exactly one fenced block tagged \`shipcode-context\` containing a JSON object with keys
\`goal\`, \`techStack\`, \`architecture\`, \`constraints\`. Each value is the full markdown content
as a string (newlines escaped as \\n, quotes as \\").

\`\`\`shipcode-context
{"goal":"...","techStack":"...","architecture":"...","constraints":"..."}
\`\`\`
`;
}

/**
 * Extract and validate the `shipcode-context` fenced block from a text blob.
 * Uses line-by-line parsing to avoid false-matching on embedded backtick sequences.
 */
function extractContextFiles(text: string): Record<string, string> {
  const openTag = `\`\`\`${CONTEXT_FENCE_TAG}`;
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
    throw new Error(`No \`${CONTEXT_FENCE_TAG}\` fenced block found in AI response`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.join('\n').trim());
  } catch (err) {
    throw new Error(
      `Failed to parse context JSON inside \`${CONTEXT_FENCE_TAG}\` block: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  for (const key of ['goal', 'techStack', 'architecture', 'constraints']) {
    if (
      !parsed ||
      typeof (parsed as Record<string, unknown>)[key] !== 'string' ||
      !(parsed as Record<string, string>)[key].trim()
    ) {
      throw new Error(`Context JSON is missing or has empty \`${key}\` key`);
    }
  }

  return parsed as Record<string, string>;
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
    const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

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
      const tidy = stderr.split('\n').slice(0, 3).join(' ').trim().slice(0, 300) || 'no stderr';
      reject(new Error(`${label} exited ${code}: ${tidy}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
