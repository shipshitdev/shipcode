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
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      pendingCreatedIssues: [],
    } as never);
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

// ---------------------------------------------------------------------------
// Voice input tests
// ---------------------------------------------------------------------------

describe('CreateIssueModal — voice input', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  let mockRecognition: {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((e: unknown) => void) | null;
    onend: (() => void) | null;
    onerror: ((e: unknown) => void) | null;
    onstart: (() => void) | null;
    start: ReturnType<typeof vi.fn> & (() => void);
    stop: ReturnType<typeof vi.fn> & (() => void);
    abort: ReturnType<typeof vi.fn> & (() => void);
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock SpeechRecognition as a constructable class.
    // The hook creates a new instance per startListening() call, so we use
    // a shared `mockRecognition` object that the constructor returns via prototype.
    mockRecognition = {
      continuous: false,
      interimResults: false,
      lang: '',
      onresult: null,
      onend: null,
      onerror: null,
      onstart: null,
      start: vi.fn<() => void>(),
      stop: vi.fn<() => void>(),
      abort: vi.fn<() => void>(),
    };

    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onstart: (() => void) | null = null;
      start = () => {
        mockRecognition.start();
        // Capture callbacks set on this instance so tests can trigger them
        mockRecognition.onresult = this.onresult;
        mockRecognition.onend = this.onend;
        mockRecognition.onerror = this.onerror;
        mockRecognition.interimResults = this.interimResults;
        mockRecognition.continuous = this.continuous;
      };
      stop = () => {
        mockRecognition.stop();
      };
      abort = () => {
        mockRecognition.abort();
      };
    }

    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSpeechRecognition,
      writable: true,
      configurable: true,
    });

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
  });

  it('shows mic button when textarea is empty in create mode', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: /start voice input/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('shows submit button once text is typed', async () => {
    renderWithProviders();
    const textarea = document.getElementById('issue-body') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '# My PRD' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /start voice input/i })).not.toBeInTheDocument();
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

  it('clicking mic button starts listening', () => {
    renderWithProviders();
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);

    expect(mockRecognition.start).toHaveBeenCalled();
    expect(mockRecognition.interimResults).toBe(true);
  });

  it('streams transcript into textarea on result', async () => {
    renderWithProviders();
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);

    // Simulate a speech result
    const resultEvent = {
      resultIndex: 0,
      results: {
        0: { 0: { transcript: 'Add login page' }, isFinal: true, length: 1 },
        length: 1,
      },
    };
    mockRecognition.onresult?.(resultEvent);

    await waitFor(() => {
      const textarea = document.getElementById('issue-body') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Add login page');
    });
  });

  it('shows stop button while listening', async () => {
    renderWithProviders();
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument();
    });
  });

  it('shows voice error when mic permission denied', async () => {
    renderWithProviders();
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);

    mockRecognition.onerror?.({ error: 'not-allowed', message: '' });
    mockRecognition.onend?.();

    await waitFor(() => {
      expect(screen.getByText(/microphone access denied/i)).toBeInTheDocument();
    });
  });

  it('stop listening called on modal close', () => {
    renderWithProviders();
    const micBtn = screen.getByRole('button', { name: /start voice input/i });
    fireEvent.click(micBtn);

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(mockRecognition.stop).toHaveBeenCalled();
  });
});
