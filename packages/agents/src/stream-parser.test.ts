import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamParser } from './stream-parser';

const VALID_PLAN = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Test objective',
  files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
  steps: [{ order: 1, description: 'Do thing', files: ['src/foo.ts'], rationale: 'Because' }],
  acceptanceCriteria: ['It works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
};

const VALID_REVIEW = {
  planId: 'plan-1',
  decision: 'approve',
  confidence: 'high',
  summary: 'Looks good',
  findings: [{ id: 'f1', severity: 'minor', category: 'design', description: 'Consider X' }],
  suggestedChanges: [],
};

const VALID_VERIFICATION = {
  threadId: 'thread-1',
  planId: 'plan-1',
  result: 'passed',
  summary: 'All good',
  criteriaResults: [{ criterion: 'Tests pass', passed: true, evidence: 'All green' }],
  issues: [],
};

function fenced(tag: string, json: unknown): string {
  return `\`\`\`${tag}\n${JSON.stringify(json, null, 2)}\n\`\`\``;
}

describe('StreamParser', () => {
  let parser: StreamParser;

  beforeEach(() => {
    parser = new StreamParser();
  });

  describe('feed / getRawOutput / reset', () => {
    it('starts with an empty buffer', () => {
      expect(parser.getRawOutput()).toBe('');
    });

    it('accumulates chunks via feed', () => {
      parser.feed('hello ');
      parser.feed('world');
      expect(parser.getRawOutput()).toBe('hello world');
    });

    it('reset clears the buffer', () => {
      parser.feed('data');
      parser.reset();
      expect(parser.getRawOutput()).toBe('');
    });
  });

  describe('getTimeSinceLastOutput', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 0 immediately after construction', () => {
      const p = new StreamParser();
      expect(p.getTimeSinceLastOutput()).toBe(0);
    });

    it('returns elapsed time since last feed', () => {
      const p = new StreamParser();
      vi.advanceTimersByTime(5000);
      expect(p.getTimeSinceLastOutput()).toBe(5000);
    });

    it('resets timer on feed', () => {
      const p = new StreamParser();
      vi.advanceTimersByTime(3000);
      p.feed('chunk');
      vi.advanceTimersByTime(1000);
      expect(p.getTimeSinceLastOutput()).toBe(1000);
    });

    it('resets timer on reset()', () => {
      const p = new StreamParser();
      vi.advanceTimersByTime(3000);
      p.reset();
      vi.advanceTimersByTime(500);
      expect(p.getTimeSinceLastOutput()).toBe(500);
    });
  });

  describe('extractPlan', () => {
    it('extracts a valid plan from a fenced block', () => {
      parser.feed(fenced('shipcode-plan', VALID_PLAN));
      const result = parser.extractPlan();
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.objective).toBe('Test objective');
      expect(result.data!.id).toBe('plan-1');
    });

    it('extracts plan when fenced block is surrounded by other text', () => {
      parser.feed('Some preamble text\n');
      parser.feed(fenced('shipcode-plan', VALID_PLAN));
      parser.feed('\nSome trailing text');
      const result = parser.extractPlan();
      expect(result.success).toBe(true);
      expect(result.data!.objective).toBe('Test objective');
    });

    it('falls back to raw JSON extraction when no fence is present (flat)', () => {
      // Use a plan with no nested objects so the non-greedy regex captures
      // the full JSON blob (first { to last } with no inner braces to trip it).
      const flatPlan = {
        ...VALID_PLAN,
        files: [],
        steps: [],
      };
      // Wrap so the only braces are the outer ones
      const json = JSON.stringify(flatPlan);
      parser.feed(`Here is the plan: ${json}`);
      const result = parser.extractPlan();
      expect(result.success).toBe(true);
      expect(result.data!.objective).toBe('Test objective');
    });

    it('returns failure when no plan is found at all', () => {
      parser.feed('just some random text with no JSON');
      const result = parser.extractPlan();
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toContain('No shipcode-plan fenced block found');
    });

    it('returns failure when fenced JSON fails schema validation', () => {
      const badPlan = { objective: 'Missing required fields' };
      parser.feed(fenced('shipcode-plan', badPlan));
      const result = parser.extractPlan();
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('returns failure when fallback JSON fails schema validation', () => {
      // A flat object with the keyword triggers the fallback regex, but
      // missing required fields cause schema validation to fail
      const badPlan = { objective: 'Incomplete plan' };
      parser.feed(`Here is output: ${JSON.stringify(badPlan)}`);
      const result = parser.extractPlan();
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toContain('schema validation failed');
    });

    it('returns failure when nested fallback JSON is truncated by regex', () => {
      // With nested objects, the non-greedy regex truncates the JSON
      parser.feed(`Here is the plan: ${JSON.stringify(VALID_PLAN)}`);
      const result = parser.extractPlan();
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('handles fenced block with extra whitespace after tag', () => {
      const content = `\`\`\`shipcode-plan   \n${JSON.stringify(VALID_PLAN)}\n\`\`\``;
      parser.feed(content);
      const result = parser.extractPlan();
      expect(result.success).toBe(true);
    });
  });

  describe('extractReview', () => {
    it('extracts a valid review from a fenced block', () => {
      parser.feed(fenced('shipcode-review', VALID_REVIEW));
      const result = parser.extractReview();
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.decision).toBe('approve');
      expect(result.data!.planId).toBe('plan-1');
    });

    it('returns failure when no review block is found', () => {
      parser.feed('no review here');
      const result = parser.extractReview();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No shipcode-review fenced block found');
    });

    it('falls back to raw JSON extraction for review', () => {
      // Use a review with no nested objects so the non-greedy regex
      // captures the complete JSON blob
      const flatReview = { ...VALID_REVIEW, findings: [], suggestedChanges: [] };
      parser.feed(`Review output: ${JSON.stringify(flatReview)}`);
      const result = parser.extractReview();
      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe('Looks good');
    });
  });

  describe('extractVerification', () => {
    it('extracts a valid verification from a fenced block', () => {
      parser.feed(fenced('shipcode-verification', VALID_VERIFICATION));
      const result = parser.extractVerification();
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.result).toBe('passed');
      expect(result.data!.threadId).toBe('thread-1');
    });

    it('returns failure when no verification block is found', () => {
      parser.feed('nothing useful');
      const result = parser.extractVerification();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No shipcode-verification fenced block found');
    });

    it('falls back to raw JSON extraction for verification', () => {
      // Use a verification with no nested objects so the non-greedy regex
      // captures the complete JSON blob
      const flatVerification = {
        ...VALID_VERIFICATION,
        criteriaResults: [],
        issues: [],
      };
      parser.feed(`Result: ${JSON.stringify(flatVerification)}`);
      const result = parser.extractVerification();
      expect(result.success).toBe(true);
      expect(result.data!.summary).toBe('All good');
    });
  });

  describe('detectError', () => {
    it('detects ENOENT as binary_missing', () => {
      parser.feed('Error: ENOENT: no such file or directory');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('binary_missing');
      expect(err!.match).toBe('ENOENT');
    });

    it('detects rate limit as rate_limited (case insensitive)', () => {
      parser.feed('You have exceeded the Rate Limit for this API');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('rate_limited');
    });

    it('detects authentication failed as auth_failed (case insensitive)', () => {
      parser.feed('Authentication has failed for user');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('auth_failed');
    });

    it('detects API key as api_key_issue (case insensitive)', () => {
      parser.feed('Invalid API Key provided');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('api_key_issue');
    });

    it('detects SIGTERM as process_killed', () => {
      parser.feed('Process received SIGTERM');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('process_killed');
      expect(err!.match).toBe('SIGTERM');
    });

    it('detects SIGKILL as process_killed', () => {
      parser.feed('Process received SIGKILL');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('process_killed');
      expect(err!.match).toBe('SIGKILL');
    });

    it('detects out of memory as oom (case insensitive)', () => {
      parser.feed('Fatal: Out Of Memory error occurred');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('oom');
    });

    it('detects timeout as timeout (case insensitive)', () => {
      parser.feed('Request Timeout after 30s');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('timeout');
    });

    it('returns null when no error pattern matches', () => {
      parser.feed('Everything is working fine, no issues here');
      const err = parser.detectError();
      expect(err).toBeNull();
    });

    it('detects errors through ANSI escape codes', () => {
      parser.feed('\x1b[31mENOENT\x1b[0m: file not found');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('binary_missing');
    });

    it('detects rate limit through ANSI escape codes', () => {
      parser.feed('\x1b[1;33mRate Limit\x1b[0m exceeded');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('rate_limited');
    });

    it('returns the first matching pattern when multiple match', () => {
      parser.feed('ENOENT and also a timeout happened');
      const err = parser.detectError();
      expect(err).not.toBeNull();
      expect(err!.type).toBe('binary_missing');
    });
  });
});
