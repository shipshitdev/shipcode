import type { ShipCodePlan } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PromptMaterial } from '../prompt-scope';
import type { SkillsRowSource } from '../skills';
import { appendExecutionNotesProtocol, buildExecutionPrompt } from './execute-prompt';
import { buildPlanPrompt, buildRevisionPrompt } from './plan-prompt';
import { buildReviewPrompt } from './review-prompt';
import { buildVerificationPrompt } from './verification-prompt';

const skills: SkillsRowSource = {
  get: () => null,
  markQuarantined: () => {},
};

const plan: ShipCodePlan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Ship scoped prompts',
  files: [{ path: 'src/a.ts', action: 'modify', description: 'Change A' }],
  steps: [{ order: 1, description: 'Do it', files: ['src/a.ts'], rationale: 'Needed' }],
  acceptanceCriteria: ['Works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

const materials: PromptMaterial[] = [
  { kind: 'issue_prompt', label: 'issue', content: 'ISSUE_PROMPT_SENTINEL' },
  { kind: 'plan_output', label: 'plan', content: 'PLAN_OUTPUT_SENTINEL' },
  { kind: 'review_feedback', label: 'review', content: 'REVIEW_FEEDBACK_SENTINEL' },
  { kind: 'repo_file_context', label: 'repo', content: 'BROAD_REPO_CONTEXT_SENTINEL' },
  { kind: 'repo_graph_context', label: 'graph', content: 'REPO_GRAPH_SENTINEL' },
  { kind: 'testing_context', label: 'tests', content: 'TEST_CONTEXT_SENTINEL' },
  { kind: 'diff_summary', label: 'diff', content: 'DIFF_SENTINEL' },
  { kind: 'verification_output', label: 'verify', content: 'VERIFY_OUTPUT_SENTINEL' },
];

describe('scoped prompt builders', () => {
  it('plan includes broad repo context and keeps plan output contract', () => {
    const prompt = buildPlanPrompt(
      'user task',
      'thread-1',
      { projectId: null },
      { skills },
      { promptMaterials: materials },
    );
    expect(prompt).toContain('BROAD_REPO_CONTEXT_SENTINEL');
    expect(prompt).toContain('REPO_GRAPH_SENTINEL');
    expect(prompt).toContain('```shipcode-plan');
  });

  it('review excludes broad repo context by default and keeps review contract', () => {
    const prompt = buildReviewPrompt(
      plan,
      { projectId: null },
      { skills },
      { promptMaterials: materials },
    );
    expect(prompt).not.toContain('BROAD_REPO_CONTEXT_SENTINEL');
    expect(prompt).not.toContain('REPO_GRAPH_SENTINEL');
    expect(prompt).toContain('PLAN_OUTPUT_SENTINEL');
    expect(prompt).toContain('```shipcode-review');
  });

  it('revision excludes broad repo context by default and keeps plan contract', () => {
    const prompt = buildRevisionPrompt(
      plan,
      'feedback',
      'thread-1',
      { projectId: null },
      { skills },
      null,
      { promptMaterials: materials },
    );
    expect(prompt).not.toContain('BROAD_REPO_CONTEXT_SENTINEL');
    expect(prompt).not.toContain('REPO_GRAPH_SENTINEL');
    expect(prompt).toContain('REVIEW_FEEDBACK_SENTINEL');
    expect(prompt).toContain('```shipcode-plan');
  });

  it('verification includes testing context without broad repo context and keeps verification contract', () => {
    const prompt = buildVerificationPrompt(
      plan,
      'diff',
      plan.acceptanceCriteria,
      { projectId: null },
      { skills },
      'test output',
      { promptMaterials: materials },
    );
    expect(prompt).not.toContain('BROAD_REPO_CONTEXT_SENTINEL');
    expect(prompt).not.toContain('REPO_GRAPH_SENTINEL');
    expect(prompt).toContain('TEST_CONTEXT_SENTINEL');
    expect(prompt).toContain('DIFF_SENTINEL');
    expect(prompt).toContain('```shipcode-verification');
  });

  it('execution excludes broad repo context by default', () => {
    const prompt = buildExecutionPrompt(
      plan,
      { projectId: null },
      { skills },
      { promptMaterials: materials },
    );
    expect(prompt).not.toContain('BROAD_REPO_CONTEXT_SENTINEL');
    expect(prompt).not.toContain('REPO_GRAPH_SENTINEL');
    expect(prompt).toContain('PLAN_OUTPUT_SENTINEL');
    expect(prompt).toContain('TEST_CONTEXT_SENTINEL');
    expect(prompt).toContain('<implementation_notes_protocol>');
    expect(prompt).toContain('implementation-notes.md');
    expect(prompt).toContain('GitHub issue content');
  });

  it('execution can build without extra scoped context', () => {
    const prompt = buildExecutionPrompt(plan, { projectId: null }, { skills });

    expect(prompt).toContain('"objective": "Ship scoped prompts"');
    expect(prompt).not.toContain('<repo_context>');
    expect(prompt).toContain('<implementation_notes_protocol>');
  });

  it('execution notes protocol appender is idempotent for custom workflow prompts', () => {
    const prompt = appendExecutionNotesProtocol('Custom execution prompt');
    const appendedAgain = appendExecutionNotesProtocol(prompt);

    expect(prompt).toContain('<implementation_notes_protocol>');
    expect(appendedAgain.match(/<implementation_notes_protocol>/g)).toHaveLength(1);
  });

  it('execution reports invalid overrides and falls back to the bundled skill', () => {
    const onFallback = vi.fn();
    const onResolved = vi.fn();
    const quarantined = vi.fn();
    const badSkills: SkillsRowSource = {
      get: () => ({
        content: 'missing frontmatter',
        baseVersion: 'bad',
        schemaVersion: 1,
        status: 'ok',
      }),
      markQuarantined: quarantined,
    };

    const prompt = buildExecutionPrompt(
      plan,
      { projectId: 'project-1' },
      { skills: badSkills, onFallback, onResolved },
    );

    expect(prompt).toContain('"objective": "Ship scoped prompts"');
    expect(onResolved).toHaveBeenCalledWith(
      'plan-execution',
      expect.objectContaining({ fallbackUsed: true }),
    );
    expect(onFallback).toHaveBeenCalledWith(
      'plan-execution',
      expect.objectContaining({ code: 'no_frontmatter' }),
    );
    expect(quarantined).toHaveBeenCalled();
  });

  it('execution appends testing and repository convention protocols when context requires them', () => {
    const contextFiles = `CLAUDE.md\n${'Follow the local conventions. '.repeat(6)}`;
    const prompt = buildExecutionPrompt(
      plan,
      { projectId: null },
      { skills },
      { contextFiles, testingContext: 'bun test' },
    );

    expect(prompt).toContain('<testing_protocol>');
    expect(prompt).toContain('<context_protocol>');
    expect(prompt).toContain('<repo_context>');
  });
});
