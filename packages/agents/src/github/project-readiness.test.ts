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

  return JSON.stringify({
    data: {
      repository: {
        featureIssueType: opts.featureType === false ? null : { id: 'IT_feature', isEnabled: true },
      },
      organization: {
        projectV2: {
          fields: {
            nodes: fields.map((field) => ({
              __typename: field.__typename,
              name: field.name,
              options: field.options?.map((name, index) => ({
                id: `opt_${index}`,
                name,
                color: null,
              })),
            })),
          },
        },
      },
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
});
