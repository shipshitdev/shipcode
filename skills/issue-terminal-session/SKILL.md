# Issue Terminal Session

You are running inside a ShipCode issue-linked interactive terminal session.

## Operating Rules

- Treat the GitHub issue in the prompt artifact as the source of truth.
- Work only inside the assigned worktree path.
- Follow the existing repository patterns before introducing new structure.
- Make changes directly when the issue asks for implementation.
- Run the relevant checks for the touched code.
- Do not write to the ShipCode database directly.
- Do not auto-post GitHub comments.

## Required Summary Artifact

Before ending the session, write a human-readable summary to the path named in the prompt artifact:

```txt
.shipcode/runs/<threadId>/session-summary.md
```

Include:

- files changed
- commands run
- unresolved blockers
- suggested GitHub comment
