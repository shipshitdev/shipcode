// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { IssueGraphNode } from './issue-graph-node';
import type { IssueGraphNodeData } from './issue-graph-utils';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type }: { type: string }) => <div data-testid={`${type}-handle`} />,
  Position: { Bottom: 'bottom', Top: 'top' },
}));

function makeProps(data: Partial<IssueGraphNodeData> = {}, selected = false): NodeProps {
  return {
    id: 'issue-1',
    data: {
      issueId: 'issue-1',
      issueNumber: 1,
      title: 'Issue title',
      pipelineStatus: 'todo',
      state: 'open',
      ...data,
    },
    selected,
  } as unknown as NodeProps;
}

describe('IssueGraphNode', () => {
  it('renders normal and selected issue nodes', () => {
    const { rerender } = render(<IssueGraphNode {...makeProps()} />);

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Issue title')).toBeInTheDocument();
    expect(screen.getByText('todo')).toBeInTheDocument();
    expect(screen.getByTestId('target-handle')).toBeInTheDocument();
    expect(screen.getByTestId('source-handle')).toBeInTheDocument();

    rerender(
      <IssueGraphNode
        {...makeProps(
          {
            issueNumber: 2,
            pipelineStatus: 'failed',
            state: 'closed',
            title: 'Failed closed issue',
          },
          true,
        )}
      />,
    );

    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('Failed closed issue')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders paused issues with the warning badge branch', () => {
    render(<IssueGraphNode {...makeProps({ pipelineStatus: 'paused', title: 'Paused issue' })} />);

    expect(screen.getByText('Paused issue')).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
  });
});
