import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PRD_FENCE_TAG = 'shipcode-prd'

export interface GeneratedPrd {
	title: string
	body: string
}

export interface GeneratePrdOptions {
	/** Free-form description of the feature from the user. */
	userPrompt: string
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
 * Build the prompt fed to the AI CLI. The prompt embeds the repo's writing-prds
 * skill (the repo's PRD style guide) verbatim, then appends the user's brain
 * dump, then asks for a single fenced block of JSON we can machine-parse.
 */
export function buildPrdPrompt(userPrompt: string, skillContent: string): string {
	return `${skillContent}

---

# Your task

A user has given you a short brain-dump of a feature they want to build in
this repo. Turn it into a complete PRD that follows the skill above.

## User brain-dump

${userPrompt}

## Output contract

Output **exactly one** fenced code block with the tag \`${PRD_FENCE_TAG}\`. Do not
output anything else. The block must contain a single JSON object with these
keys:

- \`title\`: a concise, human-readable GitHub issue title. Not kebab-case — this
  is what users will see in the issues list.
- \`body\`: the full PRD markdown body, starting with the YAML frontmatter
  (\`---\\nname: ...\\n---\\n\`), following the skill's required section order
  exactly. Must be a valid JSON string (escape newlines as \\n, quotes as \\").

If the user's brain-dump is too vague to fill a section, write \`TBD\` inline
in that section and list the missing information under \`## Risks & Open
Questions\`. Do NOT invent acceptance criteria or success metrics the user did
not imply.

Example of the expected output envelope:

\`\`\`${PRD_FENCE_TAG}
{"title":"Copy issue URL from kanban","body":"---\\nname: copy-issue-url\\n---\\n\\n# PRD: copy-issue-url\\n\\n..."}
\`\`\`
`
}

/**
 * Run the AI CLI one-shot and return a parsed PRD. Throws on:
 * - CLI spawn / timeout failure
 * - Missing fenced block in output
 * - Invalid JSON in fenced block
 * - JSON shape missing required keys
 */
export async function generatePrdFromIdea(opts: GeneratePrdOptions): Promise<GeneratedPrd> {
	const prompt = buildPrdPrompt(opts.userPrompt, opts.skillContent)
	const timeout = opts.timeoutMs ?? 180_000

	// Codex CLI one-shot invocation is not yet implemented here — fall back to
	// Claude. The user's planner-model preference is still respected elsewhere
	// (plan/review/execute phases); PRD generation is Claude-only for now.
	const { stdout } = await execFileAsync(
		'claude',
		[
			'-p',
			prompt,
			'--output-format',
			'json',
			'--max-turns',
			'1',
			'--dangerously-skip-permissions',
			'--disallowedTools',
			'Edit,Write,Bash,NotebookEdit',
		],
		{
			cwd: opts.cwd,
			maxBuffer: 20 * 1024 * 1024,
			timeout,
		},
	)

	// `claude --output-format json` returns an envelope like
	// `{ session_id: "...", result: "<assistant text>", ... }`. Unwrap it to
	// the assistant text, with a raw-stdout fallback for older CLI versions.
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
		typeof (parsed as Record<string, unknown>).title !== 'string' ||
		typeof (parsed as Record<string, unknown>).body !== 'string'
	) {
		throw new Error('PRD JSON is missing required `title` or `body` string keys')
	}

	const { title, body } = parsed as { title: string; body: string }
	if (!title.trim()) throw new Error('PRD title is empty')
	if (!body.trim()) throw new Error('PRD body is empty')

	return { title, body }
}
