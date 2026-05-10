import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { enhancePrdDraft } from '@shipcode/agents';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';

/**
 * `shipcode prd <keywords>`
 *
 * Create or enhance a GitHub issue PRD using the writing-prds skill.
 * Searches for existing issue by keywords, or generates a new PRD.
 */
export async function prdCommand(keywords: string) {
  if (!requireOnboarding()) return;

  if (!keywords.trim()) {
    console.error('Usage: shipcode prd <keywords or issue title>');
    process.exit(1);
  }

  const cwd = process.cwd();
  const ctx = createCliContext(cwd);

  // Load writing-prds skill content
  const skillPath = path.join(cwd, 'skills', 'writing-prds', 'SKILL.md');
  let skillContent = '';
  if (fs.existsSync(skillPath)) {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
  } else {
    console.log('No writing-prds skill found in repo. Using default template.\n');
    skillContent = `Write a comprehensive PRD with sections: Executive Summary, Problem Statement, Goals, Non-Goals, User Stories, System Specification, Functional Requirements, Non-Functional Requirements, Feature Phase Breakdown, Success Criteria, Out of Scope, Dependencies, Verification Plan, Risks & Open Questions. Feature Phase Breakdown must contain exactly three ordered phases.`;
  }

  // Check if there's an existing issue to enhance
  let existingBody = '';
  let existingNumber: number | null = null;

  try {
    const stdout = execFileSync(
      'gh',
      ['issue', 'list', '--search', keywords, '--json', 'number,title,body', '--limit', '1'],
      { cwd, timeout: 15_000, encoding: 'utf-8' },
    );
    const results = JSON.parse(stdout) as Array<{ number: number; title: string; body: string }>;
    if (results.length > 0) {
      const match = results[0];
      console.log(`Found existing issue #${match.number}: ${match.title}`);
      console.log('Enhancing existing PRD...\n');
      existingBody = match.body ?? '';
      existingNumber = match.number;
    }
  } catch {
    // Search failed — create new
  }

  if (!existingNumber) {
    console.log(`No existing issue found for "${keywords}". Generating new PRD...\n`);
    existingBody = `# ${keywords}\n\nTODO: Fill in PRD sections.`;
  }

  const settings = ctx.settings.get();
  const result = await enhancePrdDraft({
    draftBody: existingBody,
    skillContent,
    cwd,
    cli: settings.prdRewriteCli,
    modelId: settings.prdRewriteClaudeModel,
    reasoningEffort: settings.prdRewriteReasoningEffort,
  });

  console.log('--- Enhanced PRD ---\n');
  console.log(result.body);

  if (existingNumber) {
    console.log(`\nTo update issue #${existingNumber}:`);
    console.log(`  gh issue edit ${existingNumber} --body-file <file>`);
  } else {
    console.log(`\nTo create a new issue:`);
    console.log(`  gh issue create --title "${keywords}" --body-file <file>`);
  }
}
