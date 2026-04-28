import { Liquid, type LiquidError } from 'liquidjs';

/**
 * Strict prompt template renderer.
 *
 * WORKFLOW.md (#65) will let users author the prompt body that becomes
 * the seed for each pipeline turn. A permissive renderer turns
 * `{{ issue.titel }}` into an empty string and the agent burns turns on
 * a malformed prompt — so this engine fails loud:
 *
 *   - `strictVariables: true`  — any undefined dotted access throws.
 *   - `strictFilters: true`    — any unknown filter throws.
 *   - render is sync (templates are tiny, <50ms target).
 *   - no fs / network filters are registered.
 *
 * Consumers should catch `TemplateRenderError` and surface it through
 * the pipeline's `template_render_error` attempt state. Never swallow.
 */

export interface TemplateContext {
  issue: {
    number: number;
    title: string;
    body: string;
    labels: string[];
    state: 'open' | 'closed';
  };
  attempt: {
    number: number;
    prior_failure_reason?: string;
  };
  phase: 'plan' | 'review' | 'execute' | 'verify';
}

/**
 * Thrown when a prompt template fails to render. `message` is the
 * engine's diagnostic; `templateLine` carries the 1-based source line
 * of the offending node when the engine reports it.
 */
export class TemplateRenderError extends Error {
  readonly templateLine: number | undefined;
  readonly cause: unknown;

  constructor(message: string, opts: { cause?: unknown; templateLine?: number } = {}) {
    super(message);
    this.name = 'TemplateRenderError';
    this.cause = opts.cause;
    this.templateLine = opts.templateLine;
  }
}

let cachedEngine: Liquid | null = null;

function getEngine(): Liquid {
  if (cachedEngine) return cachedEngine;
  cachedEngine = new Liquid({
    strictVariables: true,
    strictFilters: true,
    // Disable filesystem-touching tags. Includes/render look up files on
    // disk — never want a prompt template doing that. liquidjs has no
    // network access by default.
    extname: '',
    root: [],
    relativeReference: false,
  });
  return cachedEngine;
}

/**
 * Render `source` against `ctx`. Throws `TemplateRenderError` on any
 * undefined variable, unknown filter, or syntax error.
 */
export function renderTemplate(source: string, ctx: TemplateContext): string {
  const engine = getEngine();
  try {
    return engine.parseAndRenderSync(source, ctx as unknown as Record<string, unknown>);
  } catch (err) {
    const liquidErr = err as LiquidError & { line?: number; token?: { line?: number } };
    const line = liquidErr.line ?? liquidErr.token?.line;
    const msg = err instanceof Error ? err.message : String(err);
    throw new TemplateRenderError(msg, {
      cause: err,
      ...(typeof line === 'number' ? { templateLine: line } : {}),
    });
  }
}
