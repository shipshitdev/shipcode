/**
 * Tool interface shared by every tool the OpenRouter execute harness
 * exposes to the model.
 *
 * Design notes:
 * - `schema` is a Zod schema that validates the model's raw tool-call
 *   arguments at runtime. We use Zod's JSON-schema translation for the
 *   OpenAI function-calling `parameters` field, since OpenRouter's chat
 *   completions API expects OpenAI-compatible schemas.
 * - `execute` receives the parsed input (post-Zod) + a ToolContext. It
 *   returns a ToolResult rather than throwing: tool errors (path escape,
 *   file not found, command not allowlisted) flow back to the model as
 *   content so it can course-correct instead of crashing the loop.
 * - `name` is the OpenAI function name; must match [a-zA-Z0-9_-]{1,64}.
 */

import type { ZodType } from 'zod';

export interface ToolContext {
  /**
   * The per-run worktree path. Every tool that touches the filesystem
   * MUST confine its operations to this directory via path-guard.
   */
  worktreePath: string;
  /**
   * Cancellation signal. Long-running tools (shell, grep on a big tree)
   * should honor this and abort cleanly.
   */
  signal: AbortSignal;
  /** Thread ID for logging / audit; tools must not write to DB directly. */
  threadId: string;
  /**
   * Orchestrator-supplied dependencies for the `github_graphql` tool.
   * When omitted, the tool returns a structured `auth_missing` error
   * (Symphony §10.5: orchestrator owns the credential, agent never
   * sees the token).
   */
  githubGraphql?: GithubGraphqlDeps;
}

/**
 * Per-call deps the orchestrator injects for the github_graphql tool.
 * Token reads happen at call time (not session start) so a rotation
 * during a long pipeline is picked up.
 */
export interface GithubGraphqlDeps {
  getToken(): Promise<string | null> | string | null;
  getDefaultRepo?():
    | Promise<GithubRepoCoords | null | undefined>
    | GithubRepoCoords
    | null
    | undefined;
  /** Override for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export interface GithubRepoCoords {
  owner: string;
  repo: string;
}

export type ToolResult =
  | {
      ok: true;
      content: string /** Optional structured payload for tests/telemetry. */;
      data?: unknown;
    }
  | { ok: false; error: string };

export interface Tool<Input = unknown> {
  /** OpenAI function name. Must match [a-zA-Z0-9_-]{1,64}. */
  readonly name: string;
  /** Human-readable description shown to the model. */
  readonly description: string;
  /** Runtime schema for parsing model-produced tool-call arguments. */
  readonly schema: ZodType<Input>;
  /**
   * Hand-written JSON schema for the OpenAI function-calling `parameters`
   * field. Hand-written rather than generated from Zod to avoid a
   * zod-to-json-schema converter dependency.
   */
  readonly parameters: Record<string, unknown>;
  /** Execute the tool. MUST NOT throw for handled error conditions. */
  execute(input: Input, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * OpenAI-compatible function-calling schema, matching what OpenRouter's
 * /chat/completions endpoint expects under the `tools` field.
 */
export interface OpenAIFunctionSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toOpenAISchema(tool: Tool): OpenAIFunctionSchema {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
