import { describe, expect, it } from 'vitest';
import {
  deriveGithubIssueUrl,
  githubCompareUrl,
  githubIssuesUrl,
  githubProjectsUrl,
  githubRepoUrl,
  isValidGithubLogin,
  parseGithubProjectUrl,
  parseGithubRemote,
  validateGithubProjectUrl,
} from './github-url';

describe('parseGithubRemote', () => {
  it('returns null for missing, malformed, and incomplete remotes', () => {
    expect(parseGithubRemote(null)).toBeNull();
    expect(parseGithubRemote('not a remote')).toBeNull();
    expect(parseGithubRemote('https://github.com/acme')).toBeNull();
    expect(parseGithubRemote('https://github.com//widget')).toBeNull();
    expect(parseGithubRemote('ssh://git@github.com')).toBeNull();
  });

  it('parses scp-style GitHub remotes', () => {
    expect(parseGithubRemote('git@github.com:acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses https GitHub remotes', () => {
    expect(parseGithubRemote('https://github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses ssh-scheme GitHub remotes', () => {
    expect(parseGithubRemote('ssh://git@github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('rejects non-GitHub remotes', () => {
    expect(parseGithubRemote('https://gitlab.com/acme/widget.git')).toBeNull();
    expect(parseGithubRemote('git@gitlab.com:acme/widget.git')).toBeNull();
  });
});

describe('githubRepoUrl', () => {
  it('builds the canonical repo URL from a GitHub remote', () => {
    expect(githubRepoUrl('https://github.com/acme/widget.git')).toBe(
      'https://github.com/acme/widget',
    );
  });

  it('builds issue list and issue detail URLs', () => {
    expect(githubIssuesUrl('https://github.com/acme/widget.git')).toBe(
      'https://github.com/acme/widget/issues',
    );
    expect(githubIssuesUrl('not-a-remote')).toBeNull();
    expect(deriveGithubIssueUrl('git@github.com:acme/widget.git', 42)).toBe(
      'https://github.com/acme/widget/issues/42',
    );
    expect(deriveGithubIssueUrl(null, 42)).toBeNull();
  });
});

describe('githubCompareUrl', () => {
  it('builds compare URL from scp-style remote', () => {
    expect(githubCompareUrl('git@github.com:acme/widget.git', 'main', 'feat/login')).toBe(
      'https://github.com/acme/widget/compare/main...feat%2Flogin',
    );
  });

  it('builds compare URL from https remote', () => {
    expect(githubCompareUrl('https://github.com/acme/widget.git', 'develop', 'fix/typo')).toBe(
      'https://github.com/acme/widget/compare/develop...fix%2Ftypo',
    );
  });

  it('encodes special characters in branch names', () => {
    expect(githubCompareUrl('git@github.com:acme/repo.git', 'main', 'SHIPCODE/abc_def')).toBe(
      'https://github.com/acme/repo/compare/main...SHIPCODE%2Fabc_def',
    );
  });

  it('returns null when remote is null', () => {
    expect(githubCompareUrl(null, 'main', 'feat/x')).toBeNull();
  });

  it('returns null when base is null', () => {
    expect(githubCompareUrl('git@github.com:acme/repo.git', null, 'feat/x')).toBeNull();
  });

  it('returns null when branch is null', () => {
    expect(githubCompareUrl('git@github.com:acme/repo.git', 'main', null)).toBeNull();
  });

  it('returns null when remote is unparseable', () => {
    expect(githubCompareUrl('not-a-remote', 'main', 'feat/x')).toBeNull();
  });
});

describe('githubProjectsUrl (with override)', () => {
  it('returns trimmed override when provided', () => {
    expect(
      githubProjectsUrl(
        'git@github.com:acme/widget.git',
        '  https://github.com/orgs/acme/projects/3  ',
      ),
    ).toBe('https://github.com/orgs/acme/projects/3');
  });

  it('override wins over repo-derived fallback', () => {
    expect(
      githubProjectsUrl(
        'https://github.com/acme/widget.git',
        'https://github.com/users/alice/projects/7',
      ),
    ).toBe('https://github.com/users/alice/projects/7');
  });

  it('empty/whitespace override falls through to repo base', () => {
    expect(githubProjectsUrl('git@github.com:acme/widget.git', '')).toBe(
      'https://github.com/acme/widget/projects',
    );
    expect(githubProjectsUrl('git@github.com:acme/widget.git', '   ')).toBe(
      'https://github.com/acme/widget/projects',
    );
  });

  it('null override falls through to repo base', () => {
    expect(githubProjectsUrl('git@github.com:acme/widget.git', null)).toBe(
      'https://github.com/acme/widget/projects',
    );
  });

  it('undefined override falls through to repo base (backwards-compat)', () => {
    expect(githubProjectsUrl('git@github.com:acme/widget.git')).toBe(
      'https://github.com/acme/widget/projects',
    );
  });

  it('no remote + no override returns null', () => {
    expect(githubProjectsUrl(null, null)).toBeNull();
    expect(githubProjectsUrl(undefined)).toBeNull();
  });

  it('no remote + override still returns the override', () => {
    expect(githubProjectsUrl(null, 'https://github.com/orgs/acme/projects/3')).toBe(
      'https://github.com/orgs/acme/projects/3',
    );
  });
});

describe('validateGithubProjectUrl', () => {
  it('accepts org-scoped project URL', () => {
    expect(validateGithubProjectUrl('https://github.com/orgs/acme/projects/3')).toEqual({
      ok: true,
      value: 'https://github.com/orgs/acme/projects/3',
    });
  });

  it('accepts user-scoped project URL', () => {
    expect(validateGithubProjectUrl('https://github.com/users/alice/projects/7')).toEqual({
      ok: true,
      value: 'https://github.com/users/alice/projects/7',
    });
  });

  it('accepts classic repo-scoped project URL', () => {
    expect(validateGithubProjectUrl('https://github.com/acme/repo/projects/1')).toEqual({
      ok: true,
      value: 'https://github.com/acme/repo/projects/1',
    });
  });

  it('trims whitespace from accepted URLs', () => {
    expect(validateGithubProjectUrl('  https://github.com/orgs/acme/projects/3  ')).toEqual({
      ok: true,
      value: 'https://github.com/orgs/acme/projects/3',
    });
  });

  it('null is a valid clear', () => {
    expect(validateGithubProjectUrl(null)).toEqual({ ok: true, value: null });
  });

  it('empty string is a valid clear', () => {
    expect(validateGithubProjectUrl('')).toEqual({ ok: true, value: null });
  });

  it('whitespace-only is a valid clear', () => {
    expect(validateGithubProjectUrl('   ')).toEqual({ ok: true, value: null });
  });

  it('rejects http:// scheme', () => {
    const r = validateGithubProjectUrl('http://github.com/orgs/acme/projects/3');
    expect(r.ok).toBe(false);
  });

  it('rejects non-github.com hosts', () => {
    const r = validateGithubProjectUrl('https://gitlab.com/orgs/acme/projects/3');
    expect(r.ok).toBe(false);
  });

  it('rejects an issue URL', () => {
    const r = validateGithubProjectUrl('https://github.com/acme/repo/issues/1');
    expect(r.ok).toBe(false);
  });

  it('rejects a pull URL', () => {
    const r = validateGithubProjectUrl('https://github.com/acme/repo/pull/42');
    expect(r.ok).toBe(false);
  });

  it('rejects non-numeric project number', () => {
    const r = validateGithubProjectUrl('https://github.com/orgs/acme/projects/abc');
    expect(r.ok).toBe(false);
  });

  it('rejects non-numeric classic repo project number', () => {
    const r = validateGithubProjectUrl('https://github.com/acme/repo/projects/abc');
    expect(r).toEqual({ ok: false, reason: 'Project number must be numeric' });
  });

  it('rejects project URLs with a .git-suffixed number', () => {
    const r = validateGithubProjectUrl('https://github.com/orgs/acme/projects/3.git');
    expect(r.ok).toBe(false);
  });

  it('rejects garbage string', () => {
    const r = validateGithubProjectUrl('not a url');
    expect(r.ok).toBe(false);
  });

  it('rejects owners that are not valid GitHub logins (gh @file disclosure)', () => {
    // `gh api -F login=@.env` reads .env from the project cwd; the owner must
    // be a real GitHub login so it can never start with `@`.
    expect(validateGithubProjectUrl('https://github.com/orgs/@.env/projects/1')).toEqual({
      ok: false,
      reason: 'Invalid GitHub owner in project URL',
    });
    expect(validateGithubProjectUrl('https://github.com/users/..%2F..%2Fetc/projects/1').ok).toBe(
      false,
    );
  });
});

describe('parseGithubProjectUrl', () => {
  it('parses org-scoped Projects v2 URL', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects/3')).toEqual({
      ownerType: 'orgs',
      owner: 'acme',
      number: 3,
    });
  });

  it('parses user-scoped Projects v2 URL', () => {
    expect(parseGithubProjectUrl('https://github.com/users/alice/projects/12')).toEqual({
      ownerType: 'users',
      owner: 'alice',
      number: 12,
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects/3/')).toEqual({
      ownerType: 'orgs',
      owner: 'acme',
      number: 3,
    });
  });

  it('preserves original owner case and hyphens', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/Acme-Co/projects/3')).toEqual({
      ownerType: 'orgs',
      owner: 'Acme-Co',
      number: 3,
    });
  });

  it('returns null for the legacy repo-scoped form', () => {
    // This is the `<owner>/<repo>/projects/<n>` form: it points at the
    // repo's "linked Projects" tab, not a Projects v2 board, so the parser
    // deliberately rejects it even though `validateGithubProjectUrl` accepts
    // it as an override for the Kanban quick-link button.
    expect(parseGithubProjectUrl('https://github.com/shipshitdev/shipcode/projects/1')).toBeNull();
  });

  it('returns null for a non-numeric project number', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects/abc')).toBeNull();
  });

  it('returns null for a .git-suffixed project number', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects/3.git')).toBeNull();
  });

  it('returns null when the trailing /<n> segment is missing', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects')).toBeNull();
  });

  it('returns null for http (non-https)', () => {
    expect(parseGithubProjectUrl('http://github.com/orgs/acme/projects/3')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(parseGithubProjectUrl('not a url')).toBeNull();
  });

  it('returns null for null, undefined, empty, and whitespace inputs', () => {
    expect(parseGithubProjectUrl(null)).toBeNull();
    expect(parseGithubProjectUrl(undefined)).toBeNull();
    expect(parseGithubProjectUrl('')).toBeNull();
    expect(parseGithubProjectUrl('   ')).toBeNull();
  });

  it('returns null when the owner is not a valid GitHub login (gh @file disclosure)', () => {
    // A stored URL like this would otherwise reach `gh api -F login=@.env`,
    // which the GitHub CLI expands into a read of `.env` from the project cwd.
    expect(parseGithubProjectUrl('https://github.com/orgs/@.env/projects/1')).toBeNull();
    expect(parseGithubProjectUrl('https://github.com/users/@-/projects/1')).toBeNull();
    expect(parseGithubProjectUrl('https://github.com/orgs/a.b/projects/1')).toBeNull();
  });
});

describe('isValidGithubLogin', () => {
  it('accepts valid GitHub logins', () => {
    expect(isValidGithubLogin('acme')).toBe(true);
    expect(isValidGithubLogin('Acme-Co')).toBe(true);
    expect(isValidGithubLogin('a')).toBe(true);
    expect(isValidGithubLogin('a1b2c3')).toBe(true);
  });

  it('rejects logins that could trigger gh @file expansion or path traversal', () => {
    expect(isValidGithubLogin('@.env')).toBe(false);
    expect(isValidGithubLogin('@/etc/passwd')).toBe(false);
    expect(isValidGithubLogin('a.b')).toBe(false);
    expect(isValidGithubLogin('-acme')).toBe(false);
    expect(isValidGithubLogin('acme-')).toBe(false);
    expect(isValidGithubLogin('ac--me')).toBe(false);
    expect(isValidGithubLogin('')).toBe(false);
    expect(isValidGithubLogin(null)).toBe(false);
    expect(isValidGithubLogin(undefined)).toBe(false);
    expect(isValidGithubLogin('a'.repeat(40))).toBe(false);
  });
});
