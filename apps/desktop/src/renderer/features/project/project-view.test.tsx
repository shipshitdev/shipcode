// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { ProjectView } from './project-view';

vi.mock('../../components/ConversationHome', () => ({
  ConversationHome: () => <div>conversations tab</div>,
}));

vi.mock('../../components/IssuesPanel', () => ({
  IssuesPanel: () => <div>issues tab</div>,
}));

vi.mock('../../components/pull-requests/PullRequestsPanel', () => ({
  PullRequestsPanel: () => <div>pull requests tab</div>,
}));

vi.mock('../../components/TerminalView', () => ({
  TerminalView: () => <div>terminal tab</div>,
}));

vi.mock('./code-browser', () => ({
  CodeBrowser: () => <div>code tab</div>,
}));

vi.mock('./ProjectInsights', () => ({
  ProjectInsights: () => <div>insights tab</div>,
}));

vi.mock('./project-git-visualizer', () => ({
  ProjectGitVisualizer: () => <div>git tab</div>,
}));

describe('ProjectView', () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    ['conversations', 'conversations tab'],
    ['issues', 'issues tab'],
    ['git', 'git tab'],
    ['code', 'code tab'],
    ['pull-requests', 'pull requests tab'],
    ['insights', 'insights tab'],
    ['terminal', 'terminal tab'],
  ])('renders the %s project tab', (projectTab, expectedText) => {
    useAppStore.setState({ projectTab } as never);

    render(<ProjectView />);

    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });
});
