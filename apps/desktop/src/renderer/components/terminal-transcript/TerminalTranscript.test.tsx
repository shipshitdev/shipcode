// @vitest-environment jsdom

import type { TerminalEventRecord } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

afterEach(() => {
  cleanup();
});

describe('TerminalTranscript', () => {
  it('uses the full drawer width in default mode', () => {
    const { container } = render(<TerminalTranscript events={[makeTextEvent()]} />);

    expect(screen.getByText("You've hit your limit.")).toBeInTheDocument();

    const wrapper = container.firstChild as HTMLDivElement | null;
    const scrollContainer = wrapper?.firstChild as HTMLDivElement | null;
    const innerContainer = scrollContainer?.firstChild as HTMLDivElement | null;

    expect(innerContainer).not.toBeNull();
    expect(innerContainer).toHaveClass('w-full', 'px-4', 'py-4');
    expect(innerContainer).not.toHaveClass('mx-auto', 'max-w-5xl');
  });

  it('keeps compact padding without reintroducing a width cap', () => {
    const { container } = render(<TerminalTranscript events={[makeTextEvent()]} compact />);

    const wrapper = container.firstChild as HTMLDivElement | null;
    const scrollContainer = wrapper?.firstChild as HTMLDivElement | null;
    const innerContainer = scrollContainer?.firstChild as HTMLDivElement | null;

    expect(innerContainer).not.toBeNull();
    expect(innerContainer).toHaveClass('w-full', 'p-3');
    expect(innerContainer).not.toHaveClass('mx-auto', 'max-w-5xl', 'max-w-none');
  });

  it('shows failed tool summaries inline', () => {
    render(<TerminalTranscript events={[makeToolEndEvent()]} />);

    expect(screen.getByText('Tool failed')).toBeInTheDocument();
    expect(screen.getByText('Exit 1')).toBeInTheDocument();
    expect(
      screen.getByText('Error: Cannot find module ./reference-portals.service'),
    ).toBeInTheDocument();
  });

  it('deduplicates repeated event ids before rendering rows', () => {
    render(
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

  it('renders large transcripts as a capped latest window until expanded', () => {
    const events = Array.from({ length: 305 }, (_, index) =>
      makeTextEvent({
        id: `event-${index}`,
        createdAt: `2026-04-22T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        event: { kind: 'text', content: `line ${index}` },
      }),
    );

    render(<TerminalTranscript events={events} />);

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 304')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 5 older events' }));

    expect(screen.getByText('line 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show latest 300' }));

    expect(screen.queryByText('line 0')).not.toBeInTheDocument();
    expect(screen.getByText('line 304')).toBeInTheDocument();
  });
});
