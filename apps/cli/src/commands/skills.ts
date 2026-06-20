import {
  isRepoSkillBundleKey,
  REPO_SKILL_BUNDLE_KEYS,
  seedRepoSkillBundle,
} from '@shipcode/agents';
import { sanitizeCliText } from '../adapters/cli-emitter';

export interface SeedSkillsCommandOptions {
  force?: boolean;
}

export function seedSkillsCommand(bundleName = 'dev-loop', options: SeedSkillsCommandOptions = {}) {
  if (!isRepoSkillBundleKey(bundleName)) {
    console.error(`Unknown skills bundle: ${sanitizeCliText(bundleName)}`);
    console.error(`Available bundles: ${REPO_SKILL_BUNDLE_KEYS.join(', ')}`);
    process.exit(1);
  }

  let result: ReturnType<typeof seedRepoSkillBundle>;
  try {
    result = seedRepoSkillBundle({
      bundle: bundleName,
      cwd: process.cwd(),
      force: options.force === true,
    });
  } catch (err) {
    console.error(`Failed to seed skills: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const written = result.files.filter((file) => file.status === 'written');
  const skipped = result.files.filter((file) => file.status === 'skipped');

  console.log(
    `Seeded ${sanitizeCliText(result.bundle)} skills into ${sanitizeCliText(result.targetDir)}`,
  );
  console.log(`  Written: ${written.length}`);
  console.log(`  Skipped: ${skipped.length}`);

  if (skipped.length > 0 && !options.force) {
    console.log('  Re-run with --force to overwrite existing files.');
  }
}
