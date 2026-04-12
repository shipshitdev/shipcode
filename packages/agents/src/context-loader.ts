import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTEXT_FILE_NAMES = ['GOAL.md', 'TECH-STACK.md', 'ARCHITECTURE.md', 'CONSTRAINTS.md'];
const CONTEXT_DIR = '.agents/context';

/**
 * Load repo context files from `<projectPath>/.agents/context/`.
 * Missing files are silently skipped. Returns formatted string ready
 * for injection into the `{{CONTEXT_FILES}}` prompt slot.
 */
export function loadRepoContext(projectPath: string): string {
  const parts: string[] = [];

  for (const name of CONTEXT_FILE_NAMES) {
    try {
      const content = readFileSync(join(projectPath, CONTEXT_DIR, name), 'utf-8').trim();
      if (content) {
        parts.push(`## ${name}\n${content}`);
      }
    } catch {
      // File missing or unreadable — silently skip
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : 'No repo context files found.';
}
