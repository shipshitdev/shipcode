import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PromptMaterial } from './prompt-scope';
import { stripFrontmatter } from './skills';

const MEMORY_DIR = '.agents/memory';
const PRIORITY_MEMORY_FILES = [
  'MEMORY.md',
  'goal.md',
  'architecture.md',
  'constraints.md',
  'do-dont.md',
];

export interface RepoContextSlices {
  repoContextFiles: PromptMaterial[];
  testingContext: PromptMaterial[];
}

const EMPTY_REPO_CONTEXT_SLICES: RepoContextSlices = {
  repoContextFiles: [],
  testingContext: [],
};

/**
 * Load repo memory from `<projectPath>/.agents/memory/` for prompt injection.
 * All markdown files in the folder are included, with `MEMORY.md` and the
 * generated core docs ordered first. YAML frontmatter is stripped before
 * injection.
 */
export function loadRepoContext(projectPath: string): string {
  const memoryParts = loadStructuredRepoContext(projectPath).map((material) => material.content);
  if (memoryParts.length > 0) {
    return memoryParts.join('\n\n');
  }

  return 'No repo memory files found.';
}

export function loadStructuredRepoContext(projectPath: string): PromptMaterial[] {
  const slices = loadRepoContextSlices(projectPath);
  return [...slices.repoContextFiles, ...slices.testingContext];
}

export function loadRepoContextSlices(projectPath: string): RepoContextSlices {
  let names: string[] = [];
  try {
    names = readdirSync(join(projectPath, MEMORY_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return EMPTY_REPO_CONTEXT_SLICES;
  }

  const repoContextFiles: PromptMaterial[] = [];
  const testingContext: PromptMaterial[] = [];
  const remaining = new Set(names);
  const orderedNames = PRIORITY_MEMORY_FILES.filter((name) => remaining.delete(name));
  const trailingNames = [...remaining].sort((left, right) => left.localeCompare(right));

  for (const name of [...orderedNames, ...trailingNames]) {
    try {
      const raw = readFileSync(join(projectPath, MEMORY_DIR, name), 'utf-8');
      const content = stripFrontmatter(raw).trim();
      if (content) {
        const material: PromptMaterial = {
          kind: isTestingContextFile(name, content) ? 'testing_context' : 'repo_file_context',
          label: `${MEMORY_DIR}/${name}`,
          content: `## ${name}\n${content}`,
        };
        if (material.kind === 'testing_context') {
          testingContext.push(material);
        } else {
          repoContextFiles.push(material);
        }
      }
    } catch {
      // File missing or unreadable — silently skip
    }
  }

  return { repoContextFiles, testingContext };
}

function isTestingContextFile(name: string, content: string): boolean {
  return (
    /(^|[-_.])(test|tests|testing|verify|verification|ci|setup)([-_.]|$)/i.test(name) ||
    /\b(test command|verify command|verification|bun test|npm test|pnpm test)\b/i.test(content)
  );
}
