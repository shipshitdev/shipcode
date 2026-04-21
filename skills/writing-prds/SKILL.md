---
name: writing-prds
description: Use when the user wants to draft, scope, or formalize a feature for shipcode — "write a PRD for X", "let's plan X", "scope this out", "what should X do", or when a GitHub issue body needs to be fleshed out before the pipeline plans it. Writes a PRD that maps cleanly onto shipcode's pipeline (objective / acceptanceCriteria / outOfScope / estimatedComplexity) so the planner agent can consume it without re-elicitation. Do NOT use for code edits, debugging, or PR reviews.
---

# Writing Shipcode PRDs

A PRD in shipcode is the input contract for the pipeline's **plan** phase. A good PRD is what lets the planner agent produce a usable plan in one shot instead of burning turns asking the user "what did you mean by X?". A bad PRD causes planner thrash, review rejection, and verification failures downstream.

## Storage Location

**The GitHub issue body IS the PRD.** There is no local sidecar file, no `.shipcode/prds/` directory, no SQLite-only draft. One document per work item, one location: the body of a GitHub issue in the project's connected repo.

- **Create** a PRD by creating a GitHub issue whose body is the PRD markdown (including frontmatter).
- **Edit** a PRD by editing that issue's body.
- **Version history** is GitHub's issue edit history — no manual `updated` field bumping.
- **The pipeline reads** the issue body verbatim (`packages/pipeline/src/pipeline.ts:581` — `const prompt = \`GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}\``) and feeds it into the planner agent. What you write in the issue body is exactly what the planner sees.

If shipcode's onboarding has not been completed (no GitHub repo connected), **you cannot write a PRD yet**. Complete onboarding first — shipcode is mandatory-GitHub by design.

## Frontmatter Schema

Frontmatter lives at the top of the issue body. GitHub renders it as a fenced code block in the preview — harmless, and machine-readable for any future tooling that wants to parse it.

```yaml
---
name: <kebab-name>               # kebab-case slug, matches the issue title's slugified form
description: <one-line summary>  # shown in kanban cards and issue lists
status: draft | backlog | active | blocked | completed
estimated_complexity: low | medium | high
blast_radius: contained | cross-package | cross-app | infra
---
```

Rules:

- **`name`** is a kebab-case slug. Prefer matching it to the issue title (slugified) so branch names, PR titles, and PRD references all stay consistent.
- **`estimated_complexity` feeds `PlanStructured.estimatedComplexity`** (`packages/shared/src/types.ts:12`). If the PRD author truly can't estimate, write `medium` and explain why in the Risks section.
- **`blast_radius`** tells the pipeline and the reviewer how much scrutiny to apply. `infra` means CI, Vercel config, DB migrations, release workflow — reviewer runs longer, verification retries higher.
- **`status: draft`** for PRDs that are still being elicited. The kanban should not offer "Start pipeline" on a draft. GitHub itself stays `open` — `status` here is a shipcode concept, not a GitHub state.
- **No `created` / `updated` / `github_issue` / `github_repo` fields** — GitHub tracks creation and edit history natively, and the issue IS the canonical location so there's nothing to cross-reference.

## Issue Title Style

The GitHub issue title is what the board shows most of the time. Keep it short.

- Prefer **4-7 words** when possible.
- Prefer an **imperative verb + object** shape: `Add pipeline checkpoints`, `Track CI blockers on issues`, `Expose model selectors in SettingsPanel`.
- Put the detail in the `description` frontmatter and body, not in the title.
- Avoid titles chained together with `and` / `while` / `during` unless the feature is truly one inseparable unit.
- Avoid titles that restate the full implementation loop. The title names the work item; the PRD explains it.
- Keep `name` aligned with the final issue title's slugified form. If you shorten the title, shorten `name` too.

Bad:

- `Open draft PR during execution and ingest PR feedback into stabilization loop`
- `Treat CI failures as blocker state on GitHub issue tasks`

Better:

- `Add draft PR feedback loop`
- `Track CI blockers on issues`

## Required Sections

Every shipcode PRD must have these sections, in this order. Missing sections fail quality gate.

```markdown
# PRD: <name>

## Executive Summary
<2–4 sentences. What is this feature, why now, who wins.>

## Problem Statement
<The concrete pain. Reference real incidents, real users, real metrics where possible.
Avoid "users might want..." — if you can't name the user, you don't have a problem yet.>

## Goals
- <measurable, verifiable goal>
- <measurable, verifiable goal>

## Non-Goals
- <thing this explicitly does NOT do — the more you list, the less scope creep downstream>

## User Stories
- As a <role>, I want <capability> so that <outcome>.
- Each story ends with "**Acceptance:**" followed by 1–3 concrete checks.

## Functional Requirements
<Numbered list. Each item must be verifiable by reading code or running it.
NO implementation details — "the system must do X", not "use Zustand to do X".>

## Non-Functional Requirements
<Performance, accessibility, error-handling, offline, observability.
Only list the ones that actually matter for this feature.>

## Success Criteria
<The bar the pipeline's verification phase will check against.
Every bullet here becomes an entry in `PlanStructured.acceptanceCriteria`
(`packages/shared/src/types.ts:10`). Write them like test assertions.>

## Out of Scope
<Becomes `PlanStructured.outOfScope`. Be ruthless. Future-proofs the review phase.>

## Dependencies
<Other PRDs, packages, external APIs, feature flags. Reference by path or URL.>

## Verification Plan
<How the verifier will know this shipped correctly.
`tests`: list the test files/suites that must exist and pass.
`manual`: list the manual QA steps a human will run post-merge.
`both`: both sections.
Shipcode's verification phase (`packages/pipeline/src/pipeline.ts:380`) runs
`buildVerificationPrompt(plan, diff, plan.acceptanceCriteria)` — the clearer
this section is, the fewer verification retries you burn.>

## Risks & Open Questions
<Unknowns, edge cases, things that could kill the plan mid-execution.
Open questions get tracked here until answered, then deleted.>
```

## Mapping to Shipcode's Pipeline

A PRD is read by the planner agent. Every section has a downstream consumer:

| PRD section | Feeds | Consumer |
|---|---|---|
| Executive Summary | `PlanStructured.objective` | Plan display, PR title, kanban card |
| Goals + Functional Requirements | Plan `steps` | Planner agent decomposition |
| Success Criteria | `PlanStructured.acceptanceCriteria` | Verification phase |
| Out of Scope | `PlanStructured.outOfScope` | Review phase (rejects scope creep) |
| `estimated_complexity` frontmatter | `PlanStructured.estimatedComplexity` | Review rubric, retry budget |
| Verification Plan | `buildVerificationPrompt(...)` input | Verification phase |
| Non-Goals + Out of Scope | Review gate | Reviewer rejects patches that violate these |

**Do not write sections that describe files to change, function names, or implementation choices.** Those belong in the plan, not the PRD. If the PRD author can't resist writing pseudo-code, put it under "Risks & Open Questions" as "I suspect we'll need to touch X" — not as a requirement.

## Quality Gates

Before saving a PRD with `status: backlog` (i.e. ready for the pipeline to consume), every one of these must be true:

- [ ] No placeholder text (`TODO`, `TBD`, `<fill this in>`) remains in any section.
- [ ] `Goals` has at least one measurable bullet.
- [ ] `Success Criteria` has at least one bullet, and every bullet is **verifiable without judgement** — it either passes or fails. "Feels fast" is not verifiable. "p95 latency < 300ms on the issues query" is.
- [ ] `Out of Scope` has at least one bullet. Empty `Out of Scope` is a tell that the author didn't scope the feature.
- [ ] `User Stories` has at least one story with explicit Acceptance bullets.
- [ ] Every external dependency in `Dependencies` is named (package, PRD path, or URL), not described vaguely.
- [ ] `Verification Plan` names either test file paths, suite names, or concrete manual steps — not "write some tests".

If any gate fails, keep `status: draft` and do not offer "Start pipeline" in the kanban.

## Workflow

### When the user says "write a PRD for X"

1. **Verify GitHub is connected.** The user must have completed shipcode onboarding with a repo selected. If not, stop and tell them to finish onboarding first — there is no other place a PRD can live.

2. **Do not start writing immediately.** Run a short elicitation pass first — you need answers before section-filling is meaningful:
   - What problem does this solve, and for whom specifically?
   - What does success look like — how would we measure it?
   - What is explicitly out of scope?
   - What's the complexity gut feel (low/medium/high) and why?
   - Any hard constraints — deadlines, other projects in flight, package boundaries?

3. **Check for an existing issue.** Run `gh issue list --search "<keywords>" --state all` in the target repo. If a matching issue already exists, ask whether to edit it or create a fresh one.

4. **Kebab-case the slug.** If the proposed name has spaces, camelCase, or punctuation, kebab-case it: `"Notification Center"` → `notification-center`. This slug goes in the frontmatter `name` field.

5. **Compress the issue title before writing the body.** Default to a short imperative title, then derive the frontmatter `name` from that final title. Put nuance in `description`, not the title.

6. **Draft the PRD body** using the template above, in a scratch buffer. Fill every required section. If you can't fill a section, ask the user — don't hallucinate requirements.

7. **Run the quality gates** against the draft. If any fail, set frontmatter `status: draft` and tell the user which gates failed. If they all pass, `status: backlog`.

8. **Create the GitHub issue.** Preferred: use the desktop app's Create PRD modal (which calls the `github:create-issue` IPC handler — the handler wraps `gh issue create` and upserts the cache). Alternative for CLI contexts: `gh issue create --title "<Human Readable Title>" --body-file -` with the PRD markdown piped on stdin.

9. **Confirm the outcome** to the user with the issue URL. Suggest next step: "Ready to hand this to the planner? Click Start pipeline in the kanban, or say: plan issue #N".

### When the user says "plan the X PRD"

1. Fetch the current issue body via the cache (`github_issue_cache.body`) or `gh issue view <N> --json body --jq .body` if the cache may be stale. Read it fully before producing anything.
2. Verify frontmatter `status` is `backlog` or `active` — never plan a `draft`.
3. Translate directly: Executive Summary → objective, Success Criteria → acceptanceCriteria, Out of Scope → outOfScope, `estimated_complexity` → estimatedComplexity.
4. The plan phase owns file changes and step breakdown — do not copy those out of the PRD (there shouldn't be any).

### When the user says "update the X PRD"

1. Fetch the current issue body (prefer `gh issue view <N> --json body --jq .body` to guarantee freshness).
2. Make the requested edit in a scratch buffer.
3. Write it back with `gh issue edit <N> --body-file -` (piping on stdin) or via the `github:edit-issue-body` IPC handler from the desktop app. GitHub tracks the edit history automatically.
4. If the change invalidates an in-flight plan (new acceptance criterion, new out-of-scope item), flag that explicitly to the user — they may want to kill the thread and re-plan. The local `github_issue_cache.body` will be refreshed automatically by the IPC handler; for pure CLI edits, tell the user to click "Refresh from GitHub" in IssueDetail before starting a new plan run.

## Anti-Patterns

Observed failure modes from prior sessions — do not repeat:

- **PRD full of implementation details.** Writing `use TanStack Query v5 for caching` in Functional Requirements. The PRD describes the *what*; the plan owns the *how*. This leaks into review and causes the reviewer to flag the plan for violating the PRD, which the planner then "fixes" by copying the implementation detail verbatim. Dead loop.
- **Success Criteria written as vibes.** "Users should find the flow intuitive." Unverifiable → verification retries forever.
- **Empty Out of Scope.** Always a sign the author is planning to sneak scope in later. Force the listing.
- **Authoring a PRD before the GitHub repo is connected.** If onboarding isn't complete, there is nowhere to put the PRD — finish onboarding first. Do not draft PRDs into scratch files as a workaround; they become orphan documents that drift out of sync the moment the repo is connected.
- **Editing `github_issue_cache.body` directly in SQLite.** The cache is downstream of GitHub, not upstream. Every manual DB edit is overwritten on the next `github:refresh-issues` call. Always edit via `gh issue edit` or the `github:edit-issue-body` IPC handler.
- **Creating a GitHub issue without running the quality gates first.** Quality gates exist because half-formed PRDs thrash the planner and burn verification retries. Running them after you've already created the issue means the issue is public before the gates pass — embarrassing and harder to fix than running them first.
- **Writing a PRD for something you should just ticket.** A typo fix does not need a PRD. A dependency bump does not need a PRD. Reserve PRDs for features and architectural changes that will run through the plan / review / verify / ship pipeline.

## Minimal Example

The text below is the exact issue body that gets pushed to `gh issue create --body-file -` (or, equivalently, pasted into the Create PRD modal's body field). Frontmatter and all.

```markdown
---
name: copy-issue-url-action
description: Let users copy the canonical GitHub issue URL from the kanban card context menu.
status: backlog
estimated_complexity: low
blast_radius: contained
---

# PRD: copy-issue-url-action

## Executive Summary
Users working in the kanban frequently need to paste an issue URL into Slack,
commit messages, or an external ticketing tool. Today the only way to get the
URL is to click into the issue, then copy from the header — three clicks and
a context switch. Add a "Copy URL" action to the kanban card's context menu
so it takes one click.

## Problem Statement
Observed on 2026-04-09: the user mentioned needing to paste an issue URL
into a Slack thread five times in a single session, each requiring a detour
through IssueDetail. This is pure friction — the URL is already known.

## Goals
- Right-clicking a kanban card shows a context menu with "Copy URL".
- Clicking "Copy URL" writes the issue's GitHub URL to the clipboard and
  shows a toast confirming the copy.

## Non-Goals
- Copying anything other than the URL (title, body, ID — all separate actions
  if demand appears).
- A multi-select "copy all URLs" bulk action.
- Keyboard shortcut for copy — mouse-only for v1.

## User Stories
- As a developer pasting issue links into Slack, I want to copy an issue's
  URL without leaving the kanban, so that I don't break my flow.
  **Acceptance:**
  - Right-click on a kanban card surfaces a context menu including "Copy URL".
  - Clicking it results in the URL being on the system clipboard.
  - A toast appears within 200ms confirming the copy.

## Functional Requirements
1. The kanban card component must support a right-click context menu.
2. The context menu must include an action labeled "Copy URL".
3. The URL written to the clipboard must be the canonical GitHub issue URL
   (the `html_url` returned by the GitHub API, or a deterministically
   constructed `https://github.com/<owner>/<repo>/issues/<N>` equivalent).
4. The toast notification must use the existing UI toast primitive.

## Non-Functional Requirements
- Clipboard write must succeed or fail cleanly — no silent failures. On
  permission denial, surface an error toast.

## Success Criteria
- Right-clicking any kanban card opens a context menu with a "Copy URL" item.
- Clicking "Copy URL" puts the exact string `https://github.com/<owner>/<repo>/issues/<N>`
  on the clipboard for that issue.
- A success toast appears when the copy succeeds.
- An error toast appears if the clipboard API rejects the write.

## Out of Scope
- Copying other fields (title, body, branch name).
- Bulk selection + copy.
- Keyboard shortcut bindings.
- A "Share" action that opens the URL in the browser.

## Dependencies
- The existing UI toast primitive (`@shipcode/ui`).
- `github_issue_cache.issue_number` and the project's `github_repo` for URL
  construction.

## Verification Plan
- **tests:** `apps/desktop/src/renderer/components/KanbanBoard.test.tsx` —
  add a test that simulates a right-click and asserts the context menu
  includes a "Copy URL" item wired to a mocked clipboard write.
- **manual:** right-click three cards from different projects, paste the
  clipboard into a browser tab, verify the URL loads the correct issue.

## Risks & Open Questions
- Electron's clipboard API vs the web `navigator.clipboard` — which one does
  the renderer use today? Check the existing implementation before writing
  new clipboard code.
- Do we need a focus-management consideration so that the context menu
  doesn't fight with drag-and-drop handlers on the same card?
```

Note: no `created` or `updated` fields — GitHub tracks those natively. No file path — the PRD lives in the issue body itself. The entire text block above (starting from `---`) is what gets pasted into `gh issue create --body-file -`.
