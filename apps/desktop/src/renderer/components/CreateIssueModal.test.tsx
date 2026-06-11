// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import log from 'electron-log/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { useToastStore } from '../stores/toast-store';
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
  const result = render(
    <QueryClientProvider client={queryClient}>
      <CreateIssueModal />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
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

    invokeMock.mockImplementation(async (channel: string, args?: unknown) => {
      if (channel === 'prd-attachments:create-session') {
        return { sessionId: 'test-session-id' };
      }
      if (channel === 'prd-attachments:stage') {
        const filePaths =
          args && typeof args === 'object' && 'filePaths' in args && Array.isArray(args.filePaths)
            ? args.filePaths
            : ['/tmp/test.png'];
        return {
          staged: filePaths.map((filePath: string) => {
            const fileName = filePath.split('/').pop() ?? 'test.png';
            return {
              originalPath: filePath,
              stagedPath: `/tmp/staged/${fileName}`,
              fileName,
              mimeType: 'image/png',
              sizeBytes: 1024,
            };
          }),
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
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      pendingCreatedIssues: [],
    } as never);
    useToastStore.setState({ toasts: [] });
  });

  it('renders the drop zone section in create mode', () => {
    renderWithProviders();
    const issueContent = screen.getByRole('region', { name: /issue content/i });
    expect(issueContent).toBeInTheDocument();

    const scrollRegion = document.body.querySelector('[data-create-issue-scroll-region]');
    expect(scrollRegion).toContainElement(issueContent);
  });

  it('renders the drop zone section in edit mode without drag handlers', () => {
    useAppStore.setState({
      editingPrd: {
        issueNumber: 42,
        body: '# My PRD\n## Executive Summary\n## Problem Statement\n## Goals\n## Non-Goals\n## User Stories\n## System Specification\n## Functional Requirements\n## Non-Functional Requirements\n## Feature Phase Breakdown\n## Success Criteria\n## Out of Scope\n## Dependencies\n## Verification Plan\n## Risks & Open Questions',
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

  it('reuses the existing attachment session across multiple drops', async () => {
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const firstFile = new File(['first'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['second'], 'second.png', { type: 'image/png' });
    Object.defineProperty(firstFile, 'path', { value: '/tmp/first.png', writable: false });
    Object.defineProperty(secondFile, 'path', { value: '/tmp/second.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [firstFile], items: [], types: ['Files'] },
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:stage', expect.any(Object));
    });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [secondFile], items: [], types: ['Files'] },
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'prd-attachments:stage',
        expect.objectContaining({ filePaths: ['/tmp/second.png'] }),
      );
    });
    expect(
      invokeMock.mock.calls.filter(([channel]) => channel === 'prd-attachments:create-session'),
    ).toHaveLength(1);
  });

  it('toggles the drop-zone highlight on drag over and drag leave', () => {
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });

    fireEvent.dragOver(dropZone, {
      dataTransfer: { files: [], items: [], types: ['Files'] },
    });
    expect(dropZone).toHaveClass('ring-2');

    fireEvent.dragLeave(dropZone, {
      dataTransfer: { files: [], items: [], types: ['Files'] },
    });
    expect(dropZone).not.toHaveClass('ring-2');
  });

  it('ignores empty drops and reports missing project when staging without a project', async () => {
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [], items: [], types: ['Files'] },
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      'prd-attachments:create-session',
      expect.anything(),
    );

    cleanup();
    useAppStore.setState({ activeProjectId: null } as never);
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') return [];
      return null;
    });
    renderWithProviders();

    const noProjectDropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });
    fireEvent.drop(noProjectDropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    expect(await screen.findByText('No active project')).toBeInTheDocument();
  });

  it('shows a clamped attachment error when session creation fails', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'prd-attachments:create-session') {
        throw new Error('No active project\nfull trace');
      }
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      return null;
    });

    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    expect(await screen.findByText('No active project')).toBeInTheDocument();
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

  it('keeps an attachment visible when removal fails', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'prd-attachments:create-session') return { sessionId: 'test-session-id' };
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
      if (channel === 'prd-attachments:remove') throw new Error('remove failed');
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      return null;
    });

    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    await screen.findByText('test.png');
    fireEvent.click(screen.getByRole('button', { name: /remove test\.png/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('prd-attachments:remove', expect.any(Object));
    });
    expect(screen.getByText('test.png')).toBeInTheDocument();
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

  it('logs and clears local attachment state when session cleanup fails', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'prd-attachments:create-session') return { sessionId: 'test-session-id' };
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
      if (channel === 'prd-attachments:clear') throw new Error('clear failed');
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      return null;
    });
    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.png', writable: false });
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    await screen.findByText('test.png');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(log.warn).toHaveBeenCalledWith(
        '[CreateIssueModal] failed to clear attachment session',
        expect.any(Error),
      );
    });
    expect(screen.queryByText('test.png')).not.toBeInTheDocument();
  });

  it('closes the modal on Escape', () => {
    renderWithProviders();

    fireEvent.keyDown(screen.getByText('New Issue'), { key: 'Escape' });

    expect(useAppStore.getState().createIssueModalOpen).toBe(false);
  });

  it('toggling Quick mode hides PRD textarea and shows single-line input', async () => {
    renderWithProviders();

    expect(document.getElementById('issue-body')).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', {
      name: /quick mode \(skip prd, no github issue\)/i,
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.getElementById('issue-body')).toBeNull();
    });

    const quickInput = screen.getByPlaceholderText(/describe the fix in one line/i);
    expect(quickInput).toBeInTheDocument();
    expect((quickInput as HTMLInputElement).tagName).toBe('INPUT');
  });

  it('Enter key submits quick-task and invokes pipeline:create-quick-task', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'pipeline:create-quick-task') {
        return { issue: { id: 'i-quick', issueNumber: -1, isQuickMode: true } };
      }
      return null;
    });

    renderWithProviders();

    fireEvent.click(
      screen.getByRole('checkbox', { name: /quick mode \(skip prd, no github issue\)/i }),
    );

    const quickInput = await screen.findByPlaceholderText(/describe the fix in one line/i);
    fireEvent.change(quickInput, { target: { value: 'Fix auth middleware off-by-one' } });
    fireEvent.keyDown(quickInput, { key: 'Enter' });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:create-quick-task', {
        projectId: 'project-1',
        text: 'Fix auth middleware off-by-one',
      });
    });

    expect(invokeMock).not.toHaveBeenCalledWith('github:create-issue', expect.anything());
  });

  it('does not submit quick-task when Shift+Enter is pressed', async () => {
    renderWithProviders();

    fireEvent.click(
      screen.getByRole('checkbox', { name: /quick mode \(skip prd, no github issue\)/i }),
    );

    const quickInput = await screen.findByPlaceholderText(/describe the fix in one line/i);
    fireEvent.change(quickInput, { target: { value: 'Keep editing quick task' } });
    fireEvent.keyDown(quickInput, { key: 'Enter', shiftKey: true });

    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:create-quick-task', expect.anything());
  });

  it('adds a locked creating issue immediately while GitHub create is pending', async () => {
    type CreateIssueResult = {
      issue: { id: string; projectId: string; issueNumber: number; title: string };
      projectAttachWarning: null;
    };
    let resolveCreate!: (value: CreateIssueResult) => void;
    const createPromise = new Promise<CreateIssueResult>((resolve) => {
      resolveCreate = resolve;
    });

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') {
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      }
      if (channel === 'github:create-issue') return createPromise;
      if (channel === 'github:start-issue') return undefined;
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    renderWithProviders();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '# Slow GitHub issue\n\nShip it.' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(useAppStore.getState().pendingCreatedIssues).toHaveLength(1);
    });
    expect(useAppStore.getState().pendingCreatedIssues[0]).toMatchObject({
      projectId: 'project-1',
      title: 'Slow GitHub issue',
      syncState: 'creating',
      pipelineStatus: 'queued',
    });
    expect(useAppStore.getState().createIssueModalOpen).toBe(false);

    resolveCreate({
      issue: {
        id: 'issue-123',
        projectId: 'project-1',
        issueNumber: 123,
        title: 'Slow GitHub issue',
      },
      projectAttachWarning: null,
    });

    await waitFor(() => {
      expect(useAppStore.getState().pendingCreatedIssues).toHaveLength(0);
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: 'project-1',
        issueNumber: 123,
      });
    });
  });

  it('replaces an existing cached issue when background creation returns the same id', async () => {
    const { queryClient } = renderWithProviders();
    queryClient.setQueryData(
      ['github-issues', 'project-1'],
      [
        {
          id: 'issue-123',
          projectId: 'project-1',
          issueNumber: 122,
          title: 'Old title',
          body: 'old body',
          labels: [],
        },
      ],
    );

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') {
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      }
      if (channel === 'github:create-issue') {
        return {
          issue: {
            id: 'issue-123',
            projectId: 'project-1',
            issueNumber: 123,
            title: 'Updated PRD',
            body: 'new body',
            labels: [],
          },
          projectAttachWarning: null,
        };
      }
      if (channel === 'github:start-issue') return undefined;
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Updated PRD\n\nReplace cache entry.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(queryClient.getQueryData<unknown[]>(['github-issues', 'project-1'])).toMatchObject([
        { id: 'issue-123', issueNumber: 123, title: 'Updated PRD', pipelineStatus: 'planning' },
      ]);
    });
  });

  it('submits a PRD with Cmd+Enter', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') {
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      }
      if (channel === 'github:create-issue') {
        return {
          issue: {
            id: 'issue-321',
            projectId: 'project-1',
            issueNumber: 321,
            title: 'Keyboard PRD',
          },
          projectAttachWarning: null,
        };
      }
      if (channel === 'github:start-issue') return undefined;
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Keyboard PRD\n\nShip via shortcut.' },
    });
    fireEvent.keyDown(screen.getByText('New Issue'), { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'github:create-issue',
        expect.objectContaining({ title: 'Keyboard PRD' }),
      );
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

  it('shows staging errors returned by the attachment service', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'prd-attachments:create-session') return { sessionId: 'test-session-id' };
      if (channel === 'prd-attachments:stage') {
        return { staged: [], errors: ['Only PNG files are supported'] };
      }
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      return null;
    });

    renderWithProviders();

    const dropZone = screen.getByRole('region', { name: /issue content/i });
    const file = new File(['dummy'], 'test.gif', { type: 'image/gif' });
    Object.defineProperty(file, 'path', { value: '/tmp/test.gif', writable: false });

    fireEvent.drop(dropZone, {
      dataTransfer: { files: [file], items: [], types: ['Files'] },
    });

    expect(await screen.findByText('Only PNG files are supported')).toBeInTheDocument();
  });

  it('formats a rough PRD draft and shows a clamped error when formatting fails', async () => {
    let failFormat = false;
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'ai:enhance-prd') {
        if (failFormat) throw new Error('format failed');
        return {
          body: [
            '# Formatted PRD',
            '',
            '<!-- shipcode:complexity=high blast=wide -->',
            '## Executive Summary',
            'Formatted body',
          ].join('\n'),
        };
      }
      return null;
    });

    renderWithProviders();

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'rough idea' } });
    fireEvent.click(await screen.findByRole('button', { name: /^format$/i }));

    await waitFor(() => {
      expect(textarea.value).toContain('# Formatted PRD');
    });

    failFormat = true;
    fireEvent.change(textarea, { target: { value: 'rough idea again' } });
    fireEvent.click(screen.getByRole('button', { name: /^format$/i }));

    expect(await screen.findByText(/format failed/i)).toBeInTheDocument();
  });

  it('does not format when no project is selected', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'ai:enhance-prd') throw new Error('should not format');
      return null;
    });
    useAppStore.setState({ activeProjectId: null } as never);

    renderWithProviders();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rough idea' } });
    fireEvent.click(await screen.findByRole('button', { name: /^format$/i }));

    expect(invokeMock).not.toHaveBeenCalledWith('ai:enhance-prd', expect.anything());
  });

  it('keeps the modal open and resets the draft when submit-another is enabled', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'github:create-issue') {
        return {
          issue: {
            id: 'issue-456',
            projectId: 'project-1',
            issueNumber: 456,
            title: 'Another PRD',
          },
          projectAttachWarning: 'Project board attachment is delayed',
        };
      }
      if (channel === 'github:start-issue') throw new Error('start failed');
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.click(screen.getByRole('checkbox', { name: /submit another/i }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# Another PRD\n\nShip another one.' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(textarea.value).toBe('');
      expect(useAppStore.getState().createIssueModalOpen).toBe(true);
      expect(invokeMock).toHaveBeenCalledWith(
        'github:create-issue',
        expect.objectContaining({ title: 'Another PRD' }),
      );
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
        projectId: 'project-1',
        issueNumber: 456,
      });
    });
  });

  it('shows create failures inline when submit-another is enabled', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'github:create-issue') throw new Error('GitHub is unavailable\nfull trace');
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.click(screen.getByRole('checkbox', { name: /submit another/i }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Broken PRD\n\nTry to create.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(
      await screen.findByText('Failed to create "Broken PRD": GitHub is unavailable'),
    ).toBeInTheDocument();
    expect(useAppStore.getState().pendingCreatedIssues).toHaveLength(0);
  });

  it('returns early for empty quick, empty create, invalid edit, and missing project submit attempts', async () => {
    renderWithProviders();
    fireEvent.keyDown(screen.getByText('New Issue'), { key: 'Enter', metaKey: true });

    fireEvent.click(
      screen.getByRole('checkbox', { name: /quick mode \(skip prd, no github issue\)/i }),
    );
    fireEvent.keyDown(screen.getByText('New Issue'), { key: 'Enter', metaKey: true });

    expect(invokeMock).not.toHaveBeenCalledWith('github:create-issue', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('pipeline:create-quick-task', expect.anything());

    cleanup();
    useAppStore.setState({
      createIssueModalOpen: true,
      activeProjectId: 'project-1',
      editingPrd: {
        issueNumber: 42,
        body: '# Existing PRD\n\nToo short',
        labels: [],
      },
    } as never);
    renderWithProviders();
    fireEvent.keyDown(screen.getByText('Edit PRD'), { key: 'Enter', metaKey: true });
    expect(invokeMock).not.toHaveBeenCalledWith('github:edit-issue-body', expect.anything());

    cleanup();
    useAppStore.setState({
      createIssueModalOpen: true,
      activeProjectId: null,
      editingPrd: null,
    } as never);
    renderWithProviders();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# No Project\n\nCannot submit.' },
    });
    fireEvent.keyDown(screen.getByText('New Issue'), { key: 'Enter', metaKey: true });
    expect(invokeMock).not.toHaveBeenCalledWith('github:create-issue', expect.anything());
  });

  it('shows background create failures as toasts after closing the modal', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'github:create-issue') throw new Error('GitHub is unavailable\nfull trace');
      if (channel === 'prd-attachments:clear') return undefined;
      return null;
    });

    renderWithProviders();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Toast PRD\n\nCreate in background.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        kind: 'error',
        title: 'Failed to create issue "Toast PRD"',
        body: 'GitHub is unavailable',
      });
    });
    expect(useAppStore.getState().pendingCreatedIssues).toHaveLength(0);
  });
});

describe('CreateIssueModal — empty draft actions', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();

    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}),
    };

    invokeMock.mockImplementation(async (channel: string) => {
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
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      pendingCreatedIssues: [],
    } as never);
    useToastStore.setState({ toasts: [] });
  });

  it('shows disabled create button when textarea is empty in create mode', () => {
    renderWithProviders();
    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('enables submit button once text is typed', async () => {
    renderWithProviders();
    const textarea = document.getElementById('issue-body') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# My PRD' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled();
    });
  });

  it('mic button not shown in edit mode', () => {
    useAppStore.setState({
      editingPrd: {
        issueNumber: 42,
        body: '# Existing PRD\n## Executive Summary\n## Problem Statement\n## Goals\n## Non-Goals\n## User Stories\n## System Specification\n## Functional Requirements\n## Non-Functional Requirements\n## Feature Phase Breakdown\n## Success Criteria\n## Out of Scope\n## Dependencies\n## Verification Plan\n## Risks & Open Questions',
        labels: [],
      },
    } as never);

    renderWithProviders();
    expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
  });

  it('shows missing PRD sections in edit mode and saves once the body is valid', async () => {
    useAppStore.setState({
      editingPrd: {
        issueNumber: 42,
        body: '# Existing PRD\n\nToo short',
        labels: [],
      },
    } as never);

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'github:edit-issue-body') return undefined;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/Missing required sections/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save prd/i })).toBeDisabled();

    const validBody =
      '# Valid PRD\n## Executive Summary\n## Problem Statement\n## Goals\n## Non-Goals\n## User Stories\n## System Specification\n## Functional Requirements\n## Non-Functional Requirements\n## Feature Phase Breakdown\n## Success Criteria\n## Out of Scope\n## Dependencies\n## Verification Plan\n## Risks & Open Questions';
    fireEvent.change(screen.getByRole('textbox'), { target: { value: validBody } });
    fireEvent.click(screen.getByRole('button', { name: /save prd/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'github:edit-issue-body',
        expect.objectContaining({
          projectId: 'project-1',
          issueNumber: 42,
          title: 'Valid PRD',
          body: validBody,
        }),
      );
    });
    expect(useAppStore.getState().createIssueModalOpen).toBe(false);
  });

  it('shows edit PRD save failures inline', async () => {
    useAppStore.setState({
      editingPrd: {
        issueNumber: 42,
        body: '# Existing PRD\n## Executive Summary\n## Problem Statement\n## Goals\n## Non-Goals\n## User Stories\n## System Specification\n## Functional Requirements\n## Non-Functional Requirements\n## Feature Phase Breakdown\n## Success Criteria\n## Out of Scope\n## Dependencies\n## Verification Plan\n## Risks & Open Questions',
        labels: [],
      },
    } as never);

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'github:edit-issue-body') throw new Error('edit failed\nfull trace');
      return null;
    });

    renderWithProviders();

    fireEvent.click(screen.getByRole('button', { name: /save prd/i }));

    expect(await screen.findByText(/edit failed/i)).toBeInTheDocument();
    expect(useAppStore.getState().createIssueModalOpen).toBe(true);
  });

  it('shows quick-task submit failures inline', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible')
        return [{ id: 'project-1', name: 'Test Project', path: '/tmp/repo' }];
      if (channel === 'pipeline:create-quick-task') throw new Error('quick failed');
      return null;
    });

    renderWithProviders();

    fireEvent.click(
      screen.getByRole('checkbox', { name: /quick mode \(skip prd, no github issue\)/i }),
    );
    const quickInput = await screen.findByPlaceholderText(/describe the fix in one line/i);
    fireEvent.change(quickInput, { target: { value: 'Fix quick failure' } });
    fireEvent.click(screen.getByRole('button', { name: /run quick task/i }));

    expect(await screen.findByText(/quick failed/i)).toBeInTheDocument();
  });
});
