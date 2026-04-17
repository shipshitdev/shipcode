import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type GitHubIssueCacheRecord,
  type StagedPrdAttachment,
} from '@shipcode/shared';
import { useAppStore } from '../stores/app-store';
import { CreateIssueModal } from './CreateIssueModal';

let currentSettings: AppSettings | undefined;

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: currentSettings }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@shipcode/ui', async () => {
  const React = await import('react');

  const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
    ({ children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    ),
  );
  Button.displayName = 'Button';

  const Checkbox = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
    ({ ...props }, ref) => <input ref={ref} type="checkbox" {...props} />,
  );
  Checkbox.displayName = 'Checkbox';

  const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
    ({ children: _children, ...props }, ref) => <textarea ref={ref} {...props} />,
  );
  Textarea.displayName = 'Textarea';

  const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<'label'>>(
    ({ children, ...props }, ref) => (
      <label ref={ref} {...props}>
        {children}
      </label>
    ),
  );
  Label.displayName = 'Label';

  const Dialog = ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null;
  const DialogContent = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  );
  const DialogFooter = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  );
  const DialogHeader = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  );
  const DialogTitle = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  );
  const Icon = () => <span aria-hidden="true" />;

  return {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Sparkles: Icon,
    Textarea,
    Trash2: Icon,
  };
});

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue title',
    body: '## Spec body\n\n- first item',
    labels: ['agent:claude'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    executorModel: 'claude',
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    plannerModel: 'codex',
    plannerMaxTurns: 4,
    reviewerReasoningEffort: 'high',
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<StagedPrdAttachment> = {}): StagedPrdAttachment {
  return {
    id: 'attachment-1',
    name: 'one.png',
    size: 1024,
    mimeType: 'image/png',
    ...overrides,
  };
}

function makeImageFile(name: string, pathValue: string, type = 'image/png'): File {
  const file = new File(['image-bytes'], name, { type });
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: pathValue,
  });
  return file;
}

function renderModal() {
  return render(<CreateIssueModal />);
}

describe('CreateIssueModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    currentSettings = undefined;
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

    useAppStore.setState({
      activeProjectId: 'project-1',
      activeThreadId: null,
      activeIssue: null,
      sidebarCollapsed: false,
      terminalVisible: false,
      settingsVisible: false,
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      agentOutputs: {},
      commandPaletteOpen: false,
      createIssueModalOpen: true,
      editingPrd: null,
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the active PRD rewrite settings from global settings', async () => {
    currentSettings = makeSettings();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'prd-attachments:create-session') return { attachmentSessionId: 'session-1' };
      return null;
    });

    renderModal();

    expect(screen.getByText(/Claude CLI/i)).toBeInTheDocument();
    expect(screen.getByText('codex', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('4 turns', { selector: 'span' })).toBeInTheDocument();
  });

  it('stages, removes, and threads attachment sessions into PRD rewrite requests', async () => {
    currentSettings = makeSettings();
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'prd-attachments:create-session') return { attachmentSessionId: 'session-1' };
      if (channel === 'prd-attachments:stage') {
        expect(args).toEqual(
          expect.objectContaining({
            projectId: 'project-1',
            attachmentSessionId: 'session-1',
            paths: ['/tmp/one.png', '/tmp/two.png'],
          }),
        );
        return {
          attachments: [makeAttachment(), makeAttachment({ id: 'attachment-2', name: 'two.png' })],
        };
      }
      if (channel === 'prd-attachments:remove') {
        expect(args).toEqual(
          expect.objectContaining({
            projectId: 'project-1',
            attachmentSessionId: 'session-1',
            attachmentId: 'attachment-1',
          }),
        );
        return {
          attachments: [makeAttachment({ id: 'attachment-2', name: 'two.png' })],
        };
      }
      if (channel === 'ai:enhance-prd') {
        expect(args).toEqual(
          expect.objectContaining({
            projectId: 'project-1',
            attachmentSessionId: 'session-1',
          }),
        );
        return { body: '## Executive Summary\n\nUpdated.' };
      }
      return null;
    });

    renderModal();

    const dropZone = screen.getByRole('button', { name: /drop image files here/i });
    const first = makeImageFile('one.png', '/tmp/one.png');
    const second = makeImageFile('two.png', '/tmp/two.png');

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [first, second],
      },
    } as never);

    expect(await screen.findByText('one.png')).toBeInTheDocument();
    expect(screen.getByText('two.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }));
    await waitFor(() => {
      expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    });
    expect(screen.getByText('two.png')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Build a better issue flow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enhance with AI' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'ai:enhance-prd',
        expect.objectContaining({
          projectId: 'project-1',
          attachmentSessionId: 'session-1',
        }),
      );
    });
  });

  it('preserves staged attachments after a failed create attempt', async () => {
    currentSettings = makeSettings();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'prd-attachments:create-session') return { attachmentSessionId: 'session-1' };
      if (channel === 'prd-attachments:stage') {
        return { attachments: [makeAttachment()] };
      }
      if (channel === 'github:create-issue') {
        throw new Error('GitHub is unhappy');
      }
      return null;
    });

    renderModal();

    fireEvent.drop(screen.getByRole('button', { name: /drop image files here/i }), {
      dataTransfer: {
        files: [makeImageFile('one.png', '/tmp/one.png')],
      },
    } as never);

    expect(await screen.findByText('one.png')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ship a thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Plan' }));

    expect(await screen.findByText(/GitHub is unhappy/i)).toBeInTheDocument();
    expect(screen.getByText('one.png')).toBeInTheDocument();
  });

  it('clears attachment state after a successful submit', async () => {
    currentSettings = makeSettings();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'prd-attachments:create-session') return { attachmentSessionId: 'session-1' };
      if (channel === 'prd-attachments:stage') {
        return { attachments: [makeAttachment()] };
      }
      if (channel === 'prd-attachments:clear') return undefined;
      if (channel === 'github:create-issue') {
        return {
          issue: makeIssue(),
          projectAttachWarning: null,
        };
      }
      if (channel === 'github:start-issue') return undefined;
      return null;
    });

    renderModal();

    fireEvent.drop(screen.getByRole('button', { name: /drop image files here/i }), {
      dataTransfer: {
        files: [makeImageFile('one.png', '/tmp/one.png')],
      },
    } as never);

    expect(await screen.findByText('one.png')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ship a thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Plan' }));

    await waitFor(() => {
      expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(useAppStore.getState().createIssueModalOpen).toBe(false);
    });
  });

  it('clears attachments and keeps the modal open for submit-another success paths', async () => {
    currentSettings = makeSettings();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'prd-attachments:create-session') return { attachmentSessionId: 'session-1' };
      if (channel === 'prd-attachments:stage') {
        return { attachments: [makeAttachment()] };
      }
      if (channel === 'prd-attachments:clear') return undefined;
      if (channel === 'github:create-issue') {
        return {
          issue: makeIssue({ issueNumber: 43 }),
          projectAttachWarning: null,
        };
      }
      if (channel === 'github:start-issue') return undefined;
      return null;
    });

    renderModal();

    fireEvent.drop(screen.getByRole('button', { name: /drop image files here/i }), {
      dataTransfer: {
        files: [makeImageFile('one.png', '/tmp/one.png')],
      },
    } as never);

    expect(await screen.findByText('one.png')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ship another issue' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Plan' }));

    await waitFor(() => {
      expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeInTheDocument();
  });
});
