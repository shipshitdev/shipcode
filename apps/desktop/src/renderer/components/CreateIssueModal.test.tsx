// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { CreateIssueModal } from './CreateIssueModal';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateIssueModal />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('CreateIssueModal — image drop / attachment management', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();

    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}),
    };

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'prd-attachments:create-session') {
        return { sessionId: 'test-session-id' };
      }
      if (channel === 'prd-attachments:stage') {
        return {
          staged: [
            {
              originalPath: '/tmp/test.png',
              stagedPath: '/tmp/staged/test.png',
              fileName: 'test.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
            },
          ],
          errors: [],
        };
      }
      if (channel === 'prd-attachments:remove') return undefined;
      if (channel === 'prd-attachments:clear') return undefined;
      if (channel === 'github:create-issue') {
        return { issue: { issueNumber: 1, id: 'i1' }, projectAttachWarning: null };
      }
      if (channel === 'github:start-issue') return undefined;
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      return null;
    });

    useAppStore.setState({
      createIssueModalOpen: true,
      activeProjectId: 'project-1',
      editingPrd: null,
      activeThreadId: null,
      activeIssue: null,
      viewMode: 'overview',
      sidebarCollapsed: false,
      terminalVisible: false,
      terminalMaximized: false,
      settingsVisible: false,
      settingsSection: 'general',
      issueDetailExpanded: false,
      issueDetailCollapsed: false,
      issueDetailWidth: 480,
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
    } as never);
  });

  it('renders the drop zone section in create mode', () => {
    renderWithProviders();
    expect(screen.getByRole('region', { name: /issue content/i })).toBeInTheDocument();
  });

  it('renders the drop zone section in edit mode without drag handlers', () => {
    useAppStore.setState({
      editingPrd: {
        issueNumber: 42,
        body: '# My PRD\n## Executive Summary\n## Problem Statement\n## Goals\n## Non-Goals\n## User Stories\n## Functional Requirements\n## Non-Functional Requirements\n## Success Criteria\n## Out of Scope\n## Dependencies\n## Verification Plan\n## Risks & Open Questions',
        labels: [],
      },
    } as never);

    renderWithProviders();
    // Section exists but drag-and-drop is disabled in edit mode
    expect(screen.getByRole('region', { name: /issue content/i })).toBeInTheDocument();
  });

  it('stages files on drop and shows attachment in list', async () => {
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });

    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file', getAsFile: () => file }],
        types: ['Files'],
      },
    });

    // create-session should be invoked on first drop
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:create-session', expect.any(Object));
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:stage', expect.any(Object));
    });

    // The staged attachment should appear in the list
    await waitFor(() => {
      expect(screen.getByText('test.png')).toBeInTheDocument();
    });
  });

  it('removes an attachment when the remove button is clicked', async () => {
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    await waitFor(() => {
      expect(screen.getByText('test.png')).toBeInTheDocument();
    });

    const removeBtn = screen.getByRole('button', { name: /remove test\.png/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:remove', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.queryByText('test.png')).not.toBeInTheDocument();
    });
  });

  it('clears the attachment session when the modal closes via Cancel', async () => {
    renderWithProviders();

    // Stage an attachment to create a session
    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    await waitFor(() => {
      expect(screen.getByText('test.png')).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:clear', {
        sessionId: 'test-session-id',
      });
    });
  });

  it('disables Format button when attachments are present', async () => {
    renderWithProviders();

    // Initially Format is enabled (once body is non-empty)
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Some idea here' } });

    // Wait for project query to resolve so Format button renders
    const formatBtn = await screen.findByRole('button', { name: /^format$/i });
    expect(formatBtn).not.toBeDisabled();

    // Drop an image
    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    await waitFor(() => {
      expect(screen.getByText('test.png')).toBeInTheDocument();
    });

    expect(formatBtn).toBeDisabled();
  });
});
