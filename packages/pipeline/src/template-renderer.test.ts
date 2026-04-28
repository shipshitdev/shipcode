import { describe, expect, it } from 'vitest';
import { renderTemplate, type TemplateContext, TemplateRenderError } from './template-renderer';

const baseCtx: TemplateContext = {
  issue: {
    number: 42,
    title: 'Fix the bug',
    body: 'It crashes on Sundays',
    labels: ['bug', 'high-priority'],
    state: 'open',
  },
  attempt: { number: 1 },
  phase: 'plan',
};

describe('renderTemplate', () => {
  it('renders a known-good template unchanged', () => {
    const out = renderTemplate('Issue #{{ issue.number }}: {{ issue.title }}', baseCtx);
    expect(out).toBe('Issue #42: Fix the bug');
  });

  it('renders nested loops over labels', () => {
    const out = renderTemplate('{% for label in issue.labels %}[{{ label }}]{% endfor %}', baseCtx);
    expect(out).toBe('[bug][high-priority]');
  });

  it('throws TemplateRenderError on undefined dotted access (typo)', () => {
    expect(() => renderTemplate('Title: {{ issue.titel }}', baseCtx)).toThrow(TemplateRenderError);
  });

  it('throws TemplateRenderError naming the unknown filter', () => {
    let caught: unknown;
    try {
      renderTemplate('{{ issue.title | uppercas }}', baseCtx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TemplateRenderError);
    expect((caught as TemplateRenderError).message).toMatch(/uppercas/);
  });

  it('throws TemplateRenderError on syntax error', () => {
    expect(() => renderTemplate('{{ issue.title ', baseCtx)).toThrow(TemplateRenderError);
  });

  it('exposes the cause on TemplateRenderError', () => {
    try {
      renderTemplate('{{ issue.titel }}', baseCtx);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateRenderError);
      expect((err as TemplateRenderError).cause).toBeDefined();
    }
  });

  it('does not silently substitute empty string for missing variables', () => {
    expect(() => renderTemplate('foo:{{ issue.titel }}:bar', baseCtx)).toThrow();
    // If liquidjs were lenient, output would be `foo::bar` — we never want that.
  });

  it('renders attempt + phase context', () => {
    const out = renderTemplate('attempt {{ attempt.number }} of {{ phase }}', baseCtx);
    expect(out).toBe('attempt 1 of plan');
  });

  it('renders prior_failure_reason when present', () => {
    const ctx: TemplateContext = {
      ...baseCtx,
      attempt: { number: 2, prior_failure_reason: 'tests failed' },
    };
    const out = renderTemplate(
      '{% if attempt.prior_failure_reason %}prev: {{ attempt.prior_failure_reason }}{% endif %}',
      ctx,
    );
    expect(out).toBe('prev: tests failed');
  });

  it('does not register filesystem-touching tags by default', () => {
    // `include` / `render` look up files on disk; with empty root they fail.
    expect(() => renderTemplate("{% include 'evil.liquid' %}", baseCtx)).toThrow();
  });
});
