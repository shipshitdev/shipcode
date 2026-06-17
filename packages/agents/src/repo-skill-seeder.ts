import fs from 'node:fs';
import path from 'node:path';
import { DEV_LOOP_REPO_SKILL_FILES } from './bundled-repo-skills/dev-loop.generated';

export interface RepoSkillFile {
  path: string;
  content: string;
}

export const REPO_SKILL_BUNDLE_KEYS = ['dev-loop'] as const;

export type RepoSkillBundleKey = (typeof REPO_SKILL_BUNDLE_KEYS)[number];

export interface SeedRepoSkillBundleOptions {
  bundle?: RepoSkillBundleKey;
  cwd: string;
  force?: boolean;
}

export interface SeededRepoSkillFile {
  path: string;
  absolutePath: string;
  status: 'written' | 'skipped';
}

export interface SeedRepoSkillBundleResult {
  bundle: RepoSkillBundleKey;
  targetDir: string;
  files: SeededRepoSkillFile[];
}

const REPO_SKILL_BUNDLES = {
  'dev-loop': DEV_LOOP_REPO_SKILL_FILES,
} as const satisfies Record<RepoSkillBundleKey, readonly RepoSkillFile[]>;

export function isRepoSkillBundleKey(value: string): value is RepoSkillBundleKey {
  return REPO_SKILL_BUNDLE_KEYS.includes(value as RepoSkillBundleKey);
}

export function listRepoSkillBundleFiles(
  bundle: RepoSkillBundleKey = 'dev-loop',
): readonly RepoSkillFile[] {
  return REPO_SKILL_BUNDLES[bundle];
}

export function seedRepoSkillBundle({
  bundle = 'dev-loop',
  cwd,
  force = false,
}: SeedRepoSkillBundleOptions): SeedRepoSkillBundleResult {
  const repoRoot = path.resolve(cwd);
  const targetDir = path.join(repoRoot, 'skills');
  const files: SeededRepoSkillFile[] = [];

  for (const file of listRepoSkillBundleFiles(bundle)) {
    const absolutePath = path.resolve(targetDir, file.path);
    if (!isPathInside(targetDir, absolutePath)) {
      throw new Error(`Refusing to write repo skill outside skills/: ${file.path}`);
    }

    if (!force && fs.existsSync(absolutePath)) {
      files.push({ path: path.posix.join('skills', file.path), absolutePath, status: 'skipped' });
      continue;
    }

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, 'utf-8');
    files.push({ path: path.posix.join('skills', file.path), absolutePath, status: 'written' });
  }

  return { bundle, targetDir, files };
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
