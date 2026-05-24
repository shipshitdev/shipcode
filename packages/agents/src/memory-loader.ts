import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripFrontmatter } from './skills';

const MEMORY_DIR = '.agents/memory';
const PRIORITY_MEMORY_FILES = [
  'MEMORY.md',
  'goal.md',
  'architecture.md',
  'constraints.md',
  'do-dont.md',
];

export function loadRepoMemory(projectPath: string): string {
  const memoryParts = loadMemoryParts(projectPath);
  if (memoryParts.length > 0) {
    return memoryParts.join('\n\n');
  }

  return 'No repo memory files found.';
}

function loadMemoryParts(projectPath: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(join(projectPath, MEMORY_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const parts: string[] = [];
  const remaining = new Set(names);
  const orderedNames = PRIORITY_MEMORY_FILES.filter((name) => remaining.delete(name));
  const trailingNames = [...remaining].sort((left, right) => left.localeCompare(right));

  for (const name of [...orderedNames, ...trailingNames]) {
    try {
      const raw = readFileSync(join(projectPath, MEMORY_DIR, name), 'utf-8');
      const content = stripFrontmatter(raw).trim();
      if (content) {
        parts.push(`## ${name}\n${content}`);
      }
    } catch {
      // File missing or unreadable — silently skip
    }
  }

  return parts;
}
