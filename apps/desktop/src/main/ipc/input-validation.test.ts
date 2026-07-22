import { describe, expect, it } from 'vitest';
import { IPC_INPUT_LIMITS, validateIpcInvokeArgs } from './input-validation';

describe('validateIpcInvokeArgs', () => {
  it('accepts undefined and nested plain structured input', () => {
    expect(() => validateIpcInvokeArgs('project:list', [])).not.toThrow();
    expect(() =>
      validateIpcInvokeArgs('github:create-issue', [
        {
          projectId: 'project-1',
          issueNumber: 42,
          enabled: true,
          labels: ['security', 'backend'],
          metadata: { priority: null, note: undefined },
        },
      ]),
    ).not.toThrow();
  });

  it('rejects primitive, array, and non-plain top-level payloads', () => {
    expect(() => validateIpcInvokeArgs('project:get', ['project-1'])).toThrow(
      'Invalid IPC input for project:get: expected a plain argument object',
    );
    expect(() => validateIpcInvokeArgs('pipeline:start', [['thread-1']])).toThrow(
      'Invalid IPC input for pipeline:start: expected a plain argument object',
    );
    expect(() => validateIpcInvokeArgs('github:get-issue', [new Date()])).toThrow(
      'Invalid IPC input for github:get-issue: args must be a plain object',
    );
  });

  it('rejects unsafe structured values without echoing their content', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => 'do-not-read',
    });
    const blocked = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(blocked, '__proto__', { enumerable: true, value: 'do-not-log' });

    expect(() => validateIpcInvokeArgs('project:add', [{ value: Number.NaN }])).toThrow(
      'args.value must be a finite number',
    );
    expect(() => validateIpcInvokeArgs('pipeline:retry', [circular])).toThrow(
      'args.self contains a circular reference',
    );
    expect(() => validateIpcInvokeArgs('github:add-comment', [accessor])).toThrow(
      'args.secret must not use an accessor',
    );
    expect(() => validateIpcInvokeArgs('project:save-setup', [blocked])).toThrow(
      'args contains blocked property __proto__',
    );
  });

  it('rejects unsafe array properties without invoking accessors', () => {
    const extraProperty = ['security'] as string[] & { extra?: string };
    extraProperty.extra = 'do-not-read';

    let accessorInvoked = false;
    const accessorElement = ['security'];
    Object.defineProperty(accessorElement, '0', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return 'do-not-read';
      },
    });

    expect(() => validateIpcInvokeArgs('github:create-issue', [{ labels: extraProperty }])).toThrow(
      'args.labels contains non-index array property extra',
    );
    expect(() =>
      validateIpcInvokeArgs('github:create-issue', [{ labels: accessorElement }]),
    ).toThrow('args.labels[0] must not use an accessor');
    expect(accessorInvoked).toBe(false);
  });

  it('accepts the exact string boundary and rejects one byte beyond it', () => {
    const exact = 'x'.repeat(IPC_INPUT_LIMITS.maxStringBytes);

    expect(() => validateIpcInvokeArgs('pipeline:reject', [{ feedback: exact }])).not.toThrow();
    expect(() => validateIpcInvokeArgs('pipeline:reject', [{ feedback: `${exact}x` }])).toThrow(
      `args.feedback exceeds ${IPC_INPUT_LIMITS.maxStringBytes} bytes`,
    );
  });

  it('rejects excessive nesting, collection size, and total payload bytes', () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index <= IPC_INPUT_LIMITS.maxDepth; index += 1) {
      nested = { next: nested };
    }

    expect(() => validateIpcInvokeArgs('pipeline:start', [nested])).toThrow(
      'exceeds maximum nesting depth',
    );
    expect(() =>
      validateIpcInvokeArgs('github:auto-run', [
        { priorities: Array.from({ length: IPC_INPUT_LIMITS.maxArrayItems + 1 }, () => 'p1') },
      ]),
    ).toThrow(`exceeds ${IPC_INPUT_LIMITS.maxArrayItems} array items`);
    expect(() =>
      validateIpcInvokeArgs('project:save-setup', [
        {
          first: 'x'.repeat(IPC_INPUT_LIMITS.maxStringBytes),
          second: 'x'.repeat(IPC_INPUT_LIMITS.maxStringBytes),
        },
      ]),
    ).toThrow(`payload exceeds ${IPC_INPUT_LIMITS.maxTotalBytes} bytes`);
  });
});
