export const WORKPAD_MARKER = '## ShipCode Workpad';

export const WORKPAD_SECTIONS = ['Plan', 'Acceptance Criteria', 'Validation', 'Notes'] as const;

export interface WorkpadProtocolContext {
  issueNumber: number;
}

export function buildWorkpadProtocol({ issueNumber }: WorkpadProtocolContext): string {
  const sectionList = WORKPAD_SECTIONS.map((s) => `### ${s}`).join('\n');
  return `

<workpad_protocol>
This pipeline maintains exactly ONE persistent comment on issue #${issueNumber} as the canonical state-of-work document. The marker is exactly:

${WORKPAD_MARKER}

Workflow:
1. List comments on the issue (e.g. \`gh issue view ${issueNumber} --json comments\`).
2. Find the comment whose body starts with the marker \`${WORKPAD_MARKER}\` (allow leading/trailing whitespace).
3. If found, EDIT that comment in place (\`gh issue comment <id> --edit-last\` or \`gh api -X PATCH /repos/<owner>/<repo>/issues/comments/<id>\`).
4. If not found, CREATE one new comment whose body starts with \`${WORKPAD_MARKER}\`.
5. Always replace the relevant section, never append a new top-level comment.

Required workpad layout (in this order):

${WORKPAD_MARKER}
\`<host>:<abs-cwd>@<short-sha>\`

${sectionList}

Hard rules:
- Never produce a second \`${WORKPAD_MARKER}\` comment on the same issue. One comment per pipeline.
- Never post separate per-phase summary comments (no "plan complete", "execute complete", etc.). Update the workpad instead.
- Replace the relevant section's contents on each phase. Do not append duplicate sections.
- Keep \`<host>:<abs-cwd>@<short-sha>\` line current (refresh \`<short-sha>\` after each commit).
</workpad_protocol>`;
}
