import { SHIPCODE_DEFAULT_LABELS } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const exec = vi.fn();
  const execFile = vi.fn();
  Object.assign(exec, { [promisify.custom]: vi.fn() });
  Object.assign(execFile, { [promisify.custom]: mockExecFileAsync });
  return { exec, execFile, spawn: vi.fn() };
});

import { checkProjectReadiness } from './project-readiness';

const PROJECT_URL = 'https://github.com/orgs/acme/projects/3';

function labelsJson(names = SHIPCODE_DEFAULT_LABELS.map((label) => label.name)): string {
  return JSON.stringify(names.map((name) => ({ name })));
}

function repoJson(): string {
  return JSON.stringify({ owner: { login: 'acme' }, name: 'repo' });
}

function projectResponse(opts: {
  fields?: Array<{ __typename: string; name: string; options?: string[] }>;
  featureType?: boolean;
  ownerType?: 'organization' | 'user';
  errors?: string[];
  projectMissing?: boolean;
}): string {
  const fields = opts.fields ?? [
    {
      __typename: 'ProjectV2SingleSelectField',
      name: 'Status',
      options: ['Todo', 'In Progress', 'Human Review', 'Done'],
    },
    {
      __typename: 'ProjectV2SingleSelectField',
      name: 'Priority',
      options: ['P0', 'P1', 'P2', 'P3'],
    },
    {
      __typename: 'ProjectV2SingleSelectField',
      name: 'Complexity',
      options: ['Low', 'Medium', 'High'],
    },
    {
      __typename: 'ProjectV2SingleSelectField',
      name: 'Blast radius',
      options: ['Contained', 'Cross-Package', 'Cross-App', 'Infra'],
    },
    { __typename: 'ProjectV2SingleSelectField', name: 'Component', options: ['Desktop'] },
  ];

  if (opts.errors) {
    return JSON.stringify({
      errors: opts.errors.map((message) => ({ message })),
    });
  }

  const ownerType = opts.ownerType ?? 'organization';
  const projectPayload = opts.projectMissing
    ? null
    : {
        projectV2: {
          fields: {
            nodes: fields.map((field) => ({
              __typename: field.__typename,
              name: field.name,
              options: field.options?.map((name, index) => ({
                id: `opt_${index}`,
                name,
                color: name === 'Doing' ? 'BLUE' : null,
              })),
            })),
          },
        },
      };

  return JSON.stringify({
    data: {
      repository: {
        featureIssueType: opts.featureType === false ? null : { id: 'IT_feature', isEnabled: true },
      },
      organization: ownerType === 'organization' ? projectPayload : null,
      user: ownerType === 'user' ? projectPayload : null,
    },
  });
}

describe('checkProjectReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ready when labels, issue type, and project fields are configured', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: projectResponse({}), stderr: '' });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(report.ok).toBe(true);
    expect(report.labelSync.created).toEqual([]);
    expect(report.items.map((item) => [item.key, item.status])).toContainEqual([
      'project-field:status',
      'ready',
    ]);
    expect(report.statusMapping?.humanReview).toEqual({ name: 'Human Review', color: null });
  });

  it('creates missing ShipCode labels before reporting readiness', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: labelsJson(['shipcode:agent:claude']),
      stderr: '',
    });
    for (let i = 0; i < SHIPCODE_DEFAULT_LABELS.length - 1; i++) {
      mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });
    }
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: projectResponse({}), stderr: '' });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(report.labelSync.created.length).toBe(SHIPCODE_DEFAULT_LABELS.length - 1);
    expect(report.items.find((item) => item.key === 'shipcode-labels')?.status).toBe('ready');
  });

  it('reports missing project fields and missing Feature issue type', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({
        stdout: projectResponse({
          featureType: false,
          fields: [
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Status',
              options: ['Todo', 'Done'],
            },
          ],
        }),
        stderr: '',
      });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(report.ok).toBe(false);
    expect(report.items.find((item) => item.key === 'issue-type:feature')?.status).toBe('missing');
    expect(report.items.find((item) => item.key === 'project-field:priority')?.status).toBe(
      'missing',
    );
    expect(report.items.find((item) => item.key === 'project-field:status')?.missing).toContain(
      'In Progress',
    );
  });

  it('reports a missing project URL but still checks repository issue type', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              featureIssueType: { id: 'IT_feature', isEnabled: true },
            },
          },
        }),
        stderr: '',
      });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: null,
    });

    expect(report.ok).toBe(false);
    expect(report.items.find((item) => item.key === 'github-project-url')?.status).toBe('missing');
    expect(report.items.find((item) => item.key === 'issue-type:feature')?.status).toBe('ready');
  });

  it('reports missing labels without repairing when repairLabels is false', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(['shipcode:agent:claude']), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: projectResponse({}), stderr: '' });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      repairLabels: false,
    });

    expect(report.ok).toBe(false);
    expect(report.labelSync.created).toEqual([]);
    expect(report.labelSync.failed.length).toBe(SHIPCODE_DEFAULT_LABELS.length - 1);
    expect(report.items.find((item) => item.key === 'shipcode-labels')?.status).toBe('error');
  });

  it('continues when a missing label already exists by creation time', async () => {
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: labelsJson(SHIPCODE_DEFAULT_LABELS.slice(1).map((label) => label.name)),
      stderr: '',
    });
    mockExecFileAsync
      .mockRejectedValueOnce({ stderr: 'label already exists' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: projectResponse({}), stderr: '' });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(report.ok).toBe(true);
    expect(report.labelSync.failed).toEqual([]);
  });

  it('captures label inspection and repo lookup failures as report items', async () => {
    const onWarn = vi.fn();
    mockExecFileAsync
      .mockRejectedValueOnce(new Error('label list failed'))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ owner: {}, name: '' }), stderr: '' });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      onWarn,
    });

    expect(report.ok).toBe(false);
    expect(onWarn).toHaveBeenCalledWith(
      '[project-readiness] label check failed',
      expect.any(Error),
    );
    expect(onWarn).toHaveBeenCalledWith(
      '[project-readiness] repo coordinate lookup failed',
      expect.any(Error),
    );
    expect(report.items.map((item) => [item.key, item.status])).toContainEqual([
      'github-repo',
      'error',
    ]);
  });

  it('reports GraphQL transport and response errors', async () => {
    const onWarn = vi.fn();
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockRejectedValueOnce(new Error('missing project scope'));

    const transportReport = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
      onWarn,
    });

    expect(transportReport.ok).toBe(false);
    expect(onWarn).toHaveBeenCalledWith(
      '[project-readiness] GraphQL query failed',
      expect.any(Error),
    );
    expect(transportReport.items.find((item) => item.key === 'github-project-query')?.status).toBe(
      'error',
    );

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({
        stdout: projectResponse({ errors: ['first', 'second'] }),
        stderr: '',
      });

    const graphqlReport = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(graphqlReport.ok).toBe(false);
    expect(graphqlReport.items.find((item) => item.key === 'github-project-query')?.message).toBe(
      'GitHub returned GraphQL errors: first; second',
    );
  });

  it('supports user-owned projects and alternate status option names', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({
        stdout: projectResponse({
          ownerType: 'user',
          fields: [
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Status',
              options: ['Backlog', 'Doing', 'On Hold', 'Merged'],
            },
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Priority',
              options: ['P0', 'P1', 'P2', 'P3'],
            },
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Complexity',
              options: ['Low', 'Medium', 'High'],
            },
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Blast Radius',
              options: ['Contained', 'Cross-Package', 'Cross-App', 'Infra'],
            },
            { __typename: 'ProjectV2SingleSelectField', name: 'Area', options: ['Desktop'] },
          ],
        }),
        stderr: '',
      });

    const report = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: 'https://github.com/users/acme/projects/3',
    });

    expect(report.ok).toBe(true);
    expect(report.statusMapping?.todo).toEqual({ name: 'Backlog', color: null });
    expect(report.statusMapping?.inProgress).toEqual({ name: 'Doing', color: 'BLUE' });
    expect(report.statusMapping?.humanReview).toEqual({ name: 'On Hold', color: null });
    expect(report.statusMapping?.done).toEqual({ name: 'Merged', color: null });
  });

  it('reports inaccessible projects and wrong field shapes', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: projectResponse({ projectMissing: true }), stderr: '' });

    const missingProjectReport = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(missingProjectReport.ok).toBe(false);
    expect(
      missingProjectReport.items.find((item) => item.key === 'github-project-access')?.status,
    ).toBe('error');

    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: labelsJson(), stderr: '' })
      .mockResolvedValueOnce({ stdout: repoJson(), stderr: '' })
      .mockResolvedValueOnce({
        stdout: projectResponse({
          fields: [
            { __typename: 'ProjectV2Field', name: 'Status' },
            { __typename: 'ProjectV2Field', name: 'Priority' },
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Complexity',
              options: ['Low'],
            },
            {
              __typename: 'ProjectV2SingleSelectField',
              name: 'Blast radius',
              options: ['Contained', 'Cross-Package', 'Cross-App', 'Infra'],
            },
          ],
        }),
        stderr: '',
      });

    const wrongShapeReport = await checkProjectReadiness({
      cwd: '/repo',
      projectUrl: PROJECT_URL,
    });

    expect(wrongShapeReport.ok).toBe(false);
    expect(
      wrongShapeReport.items.find((item) => item.key === 'project-field:status')?.missing,
    ).toEqual(['Todo', 'In Progress', 'Human Review or On hold', 'Done']);
    expect(
      wrongShapeReport.items.find((item) => item.key === 'project-field:priority')?.message,
    ).toBe('"Priority" must be a single-select field.');
    expect(
      wrongShapeReport.items.find((item) => item.key === 'project-field:complexity')?.missing,
    ).toEqual(['Medium', 'High']);
    expect(
      wrongShapeReport.items.find((item) => item.key === 'project-field:area-component')?.status,
    ).toBe('warning');
  });
});
