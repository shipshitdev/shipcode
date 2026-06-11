// @vitest-environment jsdom

import type { TerminalEventRecord } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTranscript } from './TerminalTranscript';

function makeTextEvent(overrides: Partial<TerminalEventRecord> = {}): TerminalEventRecord {
  return {
    id: 'event-1',
    threadId: 'thread-1',
    createdAt: '2026-04-22T11:06:05.000Z',
    event: { kind: 'text', content: "You've hit your limit." },
    ...overrides,
  };
}

function makeToolEndEvent(overrides: Partial<TerminalEventRecord> = {}): TerminalEventRecord {
  return {
    id: 'event-tool-1',
    threadId: 'thread-1',
    createdAt: '2026-04-22T11:06:24.000Z',
    event: {
      kind: 'tool_end',
      name: 'Bash',
      exitCode: 1,
      outputSummary: 'Error: Cannot find module ./reference-portals.service',
    },
    ...overrides,
  };
}

function makeRawErrorEvent(overrides: Partial<TerminalEventRecord> = {}): TerminalEventRecord {
  return {
    id: 'event-raw-error-1',
    threadId: 'thread-1',
    createdAt: '2026-04-22T11:06:30.000Z',
    event: {
      kind: 'raw',
      content: 'ERROR codex_core::session: failed to record rollout items',
    },
    ...overrides,
  };
}

const writeText = vi.fn();

function renderTranscript(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
});

describe('TerminalTranscript', () => {
  it('uses the full drawer width in default mode', () => {
    const { container } = renderTranscript(<TerminalTranscript events={[makeTextEvent()]} />);

    expect(screen.getByText("You've hit your limit.")).toBeInTheDocument();

    const wrapper = container.firstChild as HTMLDivElement | null;
    const scrollContainer = wrapper?.firstChild as HTMLDivElement | null;
    const innerContainer = scrollContainer?.firstChild as HTMLDivElement | null;

    expect(innerContainer).not.toBeNull();
    expect(innerContainer).toHaveClass('w-full', 'p-4');
    expect(innerContainer).not.toHaveClass('mx-auto', 'max-w-5xl');
  });

  it('keeps compact padding without reintroducing a width cap', () => {
    const { container } = renderTranscript(
      <TerminalTranscript events={[makeTextEvent()]} compact />,
    );

    const wrapper = container.firstChild as HTMLDivElement | null;
    const scrollContainer = wrapper?.firstChild as HTMLDivElement | null;
    const innerContainer = scrollContainer?.firstChild as HTMLDivElement | null;

    expect(innerContainer).not.toBeNull();
    expect(innerContainer).toHaveClass('w-full', 'p-3');
    expect(innerContainer).not.toHaveClass('mx-auto', 'max-w-5xl', 'max-w-none');
  });

  it('shows failed tool summaries inline', () => {
    renderTranscript(<TerminalTranscript events={[makeToolEndEvent()]} />);

    expect(screen.getByText('Tool failed')).toBeInTheDocument();
    expect(screen.getByText('Exit 1')).toBeInTheDocument();
    expect(
      screen.getByText('Error: Cannot find module ./reference-portals.service'),
    ).toBeInTheDocument();
  });

  it('renders user steering input as a distinct user block', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-user-1',
            event: { kind: 'user_input', content: 'Use the existing helper.' },
          }),
        ]}
      />,
    );

    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Use the existing helper.')).toBeInTheDocument();
  });

  it('offers auto fix on failed console output and passes the captured failure text', () => {
    const event = makeRawErrorEvent();
    const onAutoFix = vi.fn();

    renderTranscript(<TerminalTranscript events={[event]} onAutoFix={onAutoFix} />);

    fireEvent.click(screen.getByRole('button', { name: /auto fix/i }));

    expect(onAutoFix).toHaveBeenCalledWith({
      record: event,
      output: 'ERROR codex_core::session: failed to record rollout items',
    });
  });

  it('copies failed console output from the row action', async () => {
    const event = makeRawErrorEvent();

    renderTranscript(<TerminalTranscript events={[event]} />);

    fireEvent.click(screen.getByRole('button', { name: /copy failure output/i }));

    expect(writeText).toHaveBeenCalledWith(
      'ERROR codex_core::session: failed to record rollout items',
    );
    expect(
      await screen.findByRole('button', { name: /copied failure output/i }),
    ).toBeInTheDocument();
  });

  it('copies assistant messages from the message action', async () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({ id: 'event-text', event: { kind: 'text', content: 'Step completed' } }),
          makeToolEndEvent({ id: 'event-tool-failed' }),
          makeRawErrorEvent({ id: 'event-raw-error' }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy message/i }));

    const copiedText = writeText.mock.calls[0]?.[0] as string;
    expect(copiedText).toBe('Step completed');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('can send failed console output to the embedded terminal', () => {
    const event = makeRawErrorEvent();
    const onSendToTerminal = vi.fn();

    renderTranscript(<TerminalTranscript events={[event]} onSendToTerminal={onSendToTerminal} />);

    fireEvent.click(screen.getByRole('button', { name: /send failure to terminal/i }));

    expect(onSendToTerminal).toHaveBeenCalledWith({
      record: event,
      output: 'ERROR codex_core::session: failed to record rollout items',
    });
  });

  it('shows the auto fix loading state for the active failure row', () => {
    const { container } = renderTranscript(
      <TerminalTranscript
        events={[makeRawErrorEvent()]}
        onAutoFix={vi.fn()}
        autoFixingEventId="event-raw-error-1"
      />,
    );

    const button = screen.getByRole('button', { name: /auto fix/i });
    expect(button).toBeDisabled();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('deduplicates repeated event ids before rendering rows', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({ id: 'event-duplicate', event: { kind: 'text', content: 'older copy' } }),
          makeTextEvent({
            id: 'event-duplicate',
            createdAt: '2026-04-22T11:06:06.000Z',
            event: { kind: 'text', content: 'latest copy' },
          }),
        ]}
      />,
    );

    expect(screen.getByText('latest copy')).toBeInTheDocument();
    expect(screen.queryByText('older copy')).not.toBeInTheDocument();
  });

  it('shows pending and empty states when no transcript events exist', () => {
    const { rerender } = renderTranscript(
      <TerminalTranscript events={[]} pendingLabel="Waiting for Codex" />,
    );

    expect(screen.getByText(/Waiting for Codex/)).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <TerminalTranscript events={[]} emptyMessage="No execution output captured." />
      </TooltipProvider>,
    );

    expect(screen.getByText('No execution output captured.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for Codex/)).not.toBeInTheDocument();
  });

  it('renders action rows as callbacks when an action handler is provided', () => {
    const action = {
      kind: 'action',
      label: 'Open issue',
      action: 'open-issue-detail',
    } as const;
    const onAction = vi.fn();

    renderTranscript(
      <TerminalTranscript
        events={[makeTextEvent({ id: 'event-action', event: action })]}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open issue' }));

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it('renders passive action rows and skips terminal events with no visible summary', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-passive-action',
            event: { kind: 'action', label: 'Open issue', action: 'open-issue-detail' },
          }),
          makeTextEvent({
            id: 'event-tool-success',
            event: { kind: 'tool_end', name: 'Bash', exitCode: 0, durationMs: 2400 },
          }),
          makeTextEvent({
            id: 'event-turn-end-empty',
            event: { kind: 'turn_end', turn: 4 },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Open issue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open issue' })).not.toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('2.4s')).not.toBeInTheDocument();
    expect(screen.queryByText('Turn 4')).not.toBeInTheDocument();
  });

  it('renders lifecycle warnings without failure actions when no handlers are present', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-lifecycle-warning',
            event: { kind: 'lifecycle', message: 'Warning: deprecated option --legacy' },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Warning: deprecated option --legacy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /auto fix/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /send failure to terminal/i }),
    ).not.toBeInTheDocument();
  });

  it('renders informational raw console output without failure actions', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-raw-info',
            event: { kind: 'raw', content: 'install completed successfully' },
          }),
        ]}
      />,
    );

    expect(screen.getByText('install completed successfully')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy failure output/i })).not.toBeInTheDocument();
  });

  it('shows the latest work log rows when collapsed', () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      makeTextEvent({
        id: `event-work-${index}`,
        createdAt: `2026-04-22T11:06:${String(index).padStart(2, '0')}.000Z`,
        event: { kind: 'raw', content: `work item ${index}` },
      }),
    );

    renderTranscript(<TerminalTranscript events={events} />);

    expect(screen.getByText('Work log (8)')).toBeInTheDocument();
    expect(screen.queryByText('work item 0')).not.toBeInTheDocument();
    expect(screen.queryByText('work item 1')).not.toBeInTheDocument();
    expect(screen.getByText('work item 2')).toBeInTheDocument();
    expect(screen.getByText('work item 7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show 2 more/i }));

    expect(screen.getByText('work item 0')).toBeInTheDocument();
    expect(screen.getByText('work item 7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show less/i }));

    expect(screen.queryByText('work item 0')).not.toBeInTheDocument();
    expect(screen.getByText('work item 7')).toBeInTheDocument();
  });

  it('renders informational lifecycle output as plain console text', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-lifecycle-info',
            event: { kind: 'lifecycle', message: '\u001b[32mProcess started\u001b[0m' },
          }),
        ]}
        compact
      />,
    );

    expect(screen.getByText('Process started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy failure output/i })).not.toBeInTheDocument();
  });

  it('uses compact failure actions and sending state for failed console output', () => {
    const event = makeRawErrorEvent();
    const onSendToTerminal = vi.fn();

    renderTranscript(
      <TerminalTranscript
        events={[event]}
        compact
        onSendToTerminal={onSendToTerminal}
        sendingToTerminalEventId={event.id}
      />,
    );

    const sendButton = screen.getByRole('button', { name: /send failure to terminal/i });
    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveClass('h-5', 'w-5');
  });

  it('renders error and lifecycle error events with failure actions', async () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-error',
            event: { kind: 'error', message: '\u001b[31mFatal build failed\u001b[0m' },
          }),
          makeTextEvent({
            id: 'event-lifecycle-error',
            event: { kind: 'lifecycle', message: 'process exited with code 2' },
          }),
          makeToolEndEvent({
            id: 'event-tool-no-summary',
            event: { kind: 'tool_end', name: 'Bash', exitCode: 2 },
          }),
        ]}
        onSendToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText('Fatal build failed')).toBeInTheDocument();
    expect(screen.getByText('process exited with code 2')).toBeInTheDocument();
    expect(screen.getByText('Exit 2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /copy failure output/i })[0]);
    expect(writeText).toHaveBeenCalledWith('Fatal build failed');
    expect(
      await screen.findByRole('button', { name: /copied failure output/i }),
    ).toBeInTheDocument();
  });

  it('omits failure action buttons for empty error output', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-empty-error',
            event: { kind: 'error', message: '' },
          }),
        ]}
        onAutoFix={vi.fn()}
        onSendToTerminal={vi.fn()}
      />,
    );

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /auto fix/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /send failure to terminal/i }),
    ).not.toBeInTheDocument();
  });

  it('clears copied state when clipboard writing fails and skips unknown events', () => {
    writeText.mockRejectedValueOnce(new Error('blocked'));

    renderTranscript(
      <TerminalTranscript
        events={[
          makeRawErrorEvent(),
          makeTextEvent({
            id: 'event-unknown',
            event: { kind: 'unknown_event', content: 'invisible' } as never,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy failure output/i }));

    expect(writeText).toHaveBeenCalledWith(
      'ERROR codex_core::session: failed to record rollout items',
    );
    expect(screen.queryByText('invisible')).not.toBeInTheDocument();
  });

  it('resets the prior copy timer when copying another failure', async () => {
    vi.useFakeTimers();
    try {
      renderTranscript(
        <TerminalTranscript
          events={[
            makeRawErrorEvent({ id: 'event-raw-error-1' }),
            makeRawErrorEvent({
              id: 'event-raw-error-2',
              event: { kind: 'raw', content: 'Fatal: second failure' },
            }),
          ]}
        />,
      );

      fireEvent.click(screen.getAllByRole('button', { name: /copy failure output/i })[0]);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: /copied failure output/i })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      fireEvent.click(screen.getByRole('button', { name: /copy failure output/i }));
      expect(writeText).toHaveBeenLastCalledWith('Fatal: second failure');
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: /copied failure output/i })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(screen.getByRole('button', { name: /copied failure output/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders tool starts, turn summaries, completion summaries, and clarification copy', () => {
    renderTranscript(
      <TerminalTranscript
        events={[
          makeTextEvent({
            id: 'event-tool-start',
            event: { kind: 'tool_start', name: 'Bash', summary: 'bun test' },
          }),
          makeTextEvent({
            id: 'event-turn-start',
            event: { kind: 'turn_start', turn: 3 },
          }),
          makeTextEvent({
            id: 'event-turn-end',
            event: {
              kind: 'turn_end',
              turn: 3,
              tokensUsed: { prompt: 1200, completion: 300 },
              costUsd: 0.0123,
            },
          }),
          makeTextEvent({
            id: 'event-thinking',
            event: { kind: 'thinking', content: '\u001b[31mchecking failure path\u001b[0m' },
          }),
          makeTextEvent({
            id: 'event-clarification-requested',
            event: {
              kind: 'clarification_requested',
              summary: 'Need deployment target',
              questionCount: 1,
            },
          }),
          makeTextEvent({
            id: 'event-clarification-answered',
            event: { kind: 'clarification_answered', questionCount: 2 },
          }),
          makeTextEvent({
            id: 'event-done',
            event: {
              kind: 'done',
              totalTokens: { prompt: 2400, completion: 600 },
              totalCostUsd: 0.0456,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Command run')).toBeInTheDocument();
    expect(screen.getByText(/Bash: bun test/)).toBeInTheDocument();
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getByText(/1200\+300 tok/)).toHaveTextContent('$0.0123');
    expect(screen.getByText('checking failure path')).toBeInTheDocument();
    expect(screen.getByText('Need deployment target')).toBeInTheDocument();
    expect(screen.getByText('1 question waiting in the issue detail panel.')).toBeInTheDocument();
    expect(screen.getByText('Clarification answered')).toBeInTheDocument();
    expect(screen.getByText('2 responses')).toBeInTheDocument();
    expect(screen.getByText(/2400\+600 tok/)).toHaveTextContent('$0.0456');
  });

  it('renders large transcripts as a capped latest window until expanded', {
    timeout: 15_000,
  }, () => {
    const events = Array.from({ length: 305 }, (_, index) =>
      makeTextEvent({
        id: `event-${index}`,
        createdAt: `2026-04-22T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        event: { kind: 'text', content: `line ${index}` },
      }),
    );

    renderTranscript(<TerminalTranscript events={events} />);

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 304')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 5 older events' }));

    expect(screen.getByText('line 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show latest 300' }));

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 304')).toBeInTheDocument();
  });

  it('shows a scroll-to-bottom affordance after scrolling away from the bottom', () => {
    const { container } = renderTranscript(<TerminalTranscript events={[makeTextEvent()]} />);
    const scrollContainer = container.firstChild?.firstChild as HTMLDivElement;
    const scrollTo = vi.fn();

    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 100 },
      clientHeight: { configurable: true, value: 200 },
      scrollTo: { configurable: true, value: scrollTo },
    });

    fireEvent.scroll(scrollContainer);

    const scrollButton = screen.getByRole('button', { name: /scroll to bottom/i });
    fireEvent.click(scrollButton);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(screen.queryByRole('button', { name: /scroll to bottom/i })).not.toBeInTheDocument();
  });
});
