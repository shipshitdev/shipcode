import { spawn } from 'node:child_process'

const PRD_FENCE_TAG = 'shipcode-prd'

export interface GeneratedPrd {
	body: string
}

export interface EnhancePrdOptions {
	/** Current draft PRD body (may be empty, the bare template, or a real draft). */
	draftBody: string
	/** Contents of `.agents/skills/writing-prds/SKILL.md` from the target repo, or a fallback. */
	skillContent: string
	/** Which CLI to drive. Codex currently falls back to Claude. */
	plannerModel: 'claude' | 'codex'
	/** Working directory (usually the project path). */
	cwd: string
	/** Request timeout in ms. Defaults to 3 minutes. */
	timeoutMs?: number
}

/**
 * Build the prompt fed to the AI CLI. Embeds the repo's writing-prds skill
 * verbatim, then the user's current draft, then the machine-parseable output
 * contract. The caller is expected to pipe this via stdin, NOT pass it as an
 * argv argument, because the skill content starts with YAML frontmatter
 * (`---`) that would be misread as a flag by argparse.
 */
export function buildPrdPrompt(draftBody: string, skillContent: string): string {
	return `${skillContent}

---

# Your task

A user is drafting a PRD in this repo. Their current draft is below. Refine it
to meet the skill's quality bar. Preserve the user's intent and all existing
content — you are polishing and filling in gaps, not rewriting.

Expand TBD sections if you can infer sensible content from context; if you
can't, leave them as TBD and list the ambiguity under \`## Risks & Open
Questions\`. If the draft is empty or just the template scaffold, treat this
as a blank canvas and produce a complete PRD shell with TBD placeholders.

## Current draft

${draftBody}

## Output contract

Output **exactly one** fenced code block with the tag \`${PRD_FENCE_TAG}\`. Do
not output anything else. The block must contain a single JSON object with one
key:

- \`body\`: the refined PRD markdown body as a string. Must start with the YAML
  frontmatter (\`---\\nname: ...\\n---\\n\`) and include every required section
  from the skill, in order. Escape newlines as \\n and quotes as \\".

Example envelope:

\`\`\`${PRD_FENCE_TAG}
{"body":"---\\nname: copy-issue-url\\n---\\n\\n# PRD: copy-issue-url\\n\\n## Executive Summary\\n..."}
\`\`\`
`
}

/**
 * Run Claude CLI one-shot with the prompt piped via stdin and return a parsed
 * PRD body. Throws with a short, prompt-free error on failure.
 */
export async function enhancePrdDraft(opts: EnhancePrdOptions): Promise<GeneratedPrd> {
	const prompt = buildPrdPrompt(opts.draftBody, opts.skillContent)
	const timeout = opts.timeoutMs ?? 180_000

	// Codex CLI one-shot invocation is not yet implemented — fall back to
	// Claude. The user's planner-model preference is respected elsewhere; PRD
	// enhancement is Claude-only for now.
	void opts.plannerModel

	const stdout = await runClaudeWithStdin(prompt, opts.cwd, timeout)

	// `claude -p --output-format json` returns an envelope
	// `{ session_id, result, ... }`. Unwrap to `result`, with a raw-stdout
	// fallback for older CLI versions that already return plain text.
	let text = stdout
	try {
		const envelope = JSON.parse(stdout) as Record<string, unknown>
		if (envelope && typeof envelope.result === 'string') {
			text = envelope.result
		}
	} catch {
		// not a JSON envelope — use raw stdout
	}

	return extractPrd(text)
}

/**
 * Spawn `claude -p` with no prompt argv and pipe the prompt through stdin.
 *
 * Argv piping is deliberate: the prompt starts with YAML frontmatter (`---`)
 * which Claude CLI's argparser would reject as an unknown flag if passed as an
 * argument. See `packages/agents/src/github/gh-cli.ts:117` for the same
 * pattern used by `gh issue create --body-file -`.
 */
function runClaudeWithStdin(prompt: string, cwd: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(
			'claude',
			[
				'-p',
				'--output-format',
				'json',
				'--max-turns',
				'1',
				'--dangerously-skip-permissions',
				'--disallowedTools',
				'Edit,Write,Bash,NotebookEdit',
			],
			{ cwd, stdio: ['pipe', 'pipe', 'pipe'] },
		)

		let stdout = ''
		let stderr = ''
		proc.stdout.on('data', (chunk) => {
			stdout += chunk
		})
		proc.stderr.on('data', (chunk) => {
			stderr += chunk
		})

		const timer = setTimeout(() => {
			proc.kill('SIGTERM')
			reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`))
		}, timeoutMs)

		proc.on('error', (err) => {
			clearTimeout(timer)
			// ENOENT etc — surface a short message, never echo the prompt.
			reject(new Error(`Claude CLI spawn failed: ${err.message.split('\n')[0].slice(0, 200)}`))
		})

		proc.on('close', (code) => {
			clearTimeout(timer)
			if (code === 0) {
				resolve(stdout)
				return
			}
			// Trim stderr to a sensible length. Do NOT include stdout / prompt.
			const tidy =
				stderr.split('\n').slice(0, 3).join(' ').trim().slice(0, 300) || 'no stderr'
			reject(new Error(`Claude CLI exited ${code}: ${tidy}`))
		})

		proc.stdin.write(prompt)
		proc.stdin.end()
	})
}

/** Extract and validate the `shipcode-prd` fenced block from a text blob. */
export function extractPrd(text: string): GeneratedPrd {
	const fenceRegex = new RegExp(`\`\`\`${PRD_FENCE_TAG}\\s*\\n([\\s\\S]*?)\`\`\``, 'm')
	const match = text.match(fenceRegex)
	if (!match) {
		throw new Error(`No \`${PRD_FENCE_TAG}\` fenced block found in AI response`)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(match[1].trim())
	} catch (err) {
		throw new Error(
			`Failed to parse PRD JSON inside \`${PRD_FENCE_TAG}\` block: ${
				err instanceof Error ? err.message : String(err)
			}`,
		)
	}

	if (
		!parsed ||
		typeof parsed !== 'object' ||
		typeof (parsed as Record<string, unknown>).body !== 'string'
	) {
		throw new Error('PRD JSON is missing required `body` string key')
	}

	const body = (parsed as { body: string }).body
	if (!body.trim()) throw new Error('PRD body is empty')

	return { body }
}
