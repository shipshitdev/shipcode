# Secret Scanning

ShipCode uses two complementary gitleaks workflows. Both download the repository-pinned
gitleaks release and verify its SHA-256 checksum before execution.

## Pull Requests and Pushes

`.github/workflows/secret-scan.yml` is the required, fast path. Every pull request and push
runs `gitleaks dir` against a fresh checkout. It scans the checked-out filesystem only and
does not traverse earlier commits.

This workflow remains the merge gate because it gives prompt feedback without making every
pull request replay the repository's full history.

## Full-History Audit

`.github/workflows/secret-history-scan.yml` runs at 04:00 UTC every Monday and can be started
manually:

```bash
gh workflow run secret-history-scan.yml --repo shipshitdev/shipcode --ref master
```

The workflow checks out complete history with credentials disabled, rejects shallow or
missing-ref checkouts, and runs `gitleaks git --log-opts="--all -m"`. Its scope is every
commit reachable from the fetched remote branches and tags, including merge-parent diffs.
Findings exit non-zero, and gitleaks redacts secret values from logs. The workflow does not
upload a findings artifact because an unredacted artifact could become a second disclosure.

## Remediation

Treat a finding as an exposed credential until proven otherwise:

1. Revoke or rotate the credential immediately. Removing a commit does not make the value
   safe.
2. Record only the redacted rule, fingerprint, path, and commit from the workflow log. Never
   paste the secret into an issue, pull request, or chat.
3. Check provider access logs and open a private incident if the credential was live.
4. For a verified false positive, add only the narrow finding fingerprint to
   `.gitleaksignore` in a reviewed pull request. Do not add a broad baseline or rule
   suppression.
5. If history cleanup is required, coordinate an explicit history-rewrite plan separately.
   Rewriting and force-pushing shared refs is destructive and is not performed by either
   scanning workflow.
6. Re-run the manual full-history workflow after rotation and any approved cleanup.
