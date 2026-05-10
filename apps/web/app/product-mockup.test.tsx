import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const dynamicOptions = vi.hoisted(() => [] as Array<{ ssr?: boolean }>);
const dynamicLoaderPromises = vi.hoisted(() => [] as Array<Promise<unknown>>);

vi.mock('next/dynamic', () => ({
  default: (loader: unknown, options: { ssr?: boolean }) => {
    dynamicOptions.push(options);
    dynamicLoaderPromises.push(Promise.resolve((loader as () => Promise<unknown>)()));
    return function MockKanbanBoard(props: {
      projectName: string;
      selectedIssueNumber?: number;
      onIssueClick: () => void;
      onRefresh: () => void;
      onBaseBranchChange: () => void;
      onRefreshBranches: () => void;
      onOpenExternal: () => void;
    }) {
      props.onIssueClick();
      props.onRefresh();
      props.onBaseBranchChange();
      props.onRefreshBranches();
      props.onOpenExternal();
      return (
        <div data-project-name={props.projectName} data-selected-issue={props.selectedIssueNumber}>
          Mock Kanban
        </div>
      );
    };
  },
}));

import { ProductMockup } from '@/components/ProductMockup';

describe('ProductMockup', () => {
  it('renders the homepage board shell with client-only dynamic kanban loading', async () => {
    await Promise.all(dynamicLoaderPromises);
    const html = renderToStaticMarkup(<ProductMockup />);

    expect(dynamicOptions).toContainEqual({ ssr: false });
    expect(html).toContain('data-project-name="ShipCode Dashboard"');
    expect(html).toContain('data-selected-issue="198"');
    expect(html).toContain('product-mockup-inner');
  });
});
