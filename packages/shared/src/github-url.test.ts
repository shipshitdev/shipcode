import { describe, it, expect } from 'vitest';
import {
  githubProjectsUrl,
  validateGithubProjectUrl,
  parseGithubProjectUrl,
} from './github-url';

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
    expect(
      validateGithubProjectUrl('  https://github.com/orgs/acme/projects/3  '),
    ).toEqual({ ok: true, value: 'https://github.com/orgs/acme/projects/3' });
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

  it('rejects garbage string', () => {
    const r = validateGithubProjectUrl('not a url');
    expect(r.ok).toBe(false);
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

  it('returns null when the trailing /<n> segment is missing', () => {
    expect(parseGithubProjectUrl('https://github.com/orgs/acme/projects')).toBeNull();
  });

  it('returns null for http (non-https)', () => {
    expect(parseGithubProjectUrl('http://github.com/orgs/acme/projects/3')).toBeNull();
  });

  it('returns null for null, undefined, empty, and whitespace inputs', () => {
    expect(parseGithubProjectUrl(null)).toBeNull();
    expect(parseGithubProjectUrl(undefined)).toBeNull();
    expect(parseGithubProjectUrl('')).toBeNull();
    expect(parseGithubProjectUrl('   ')).toBeNull();
  });
});
