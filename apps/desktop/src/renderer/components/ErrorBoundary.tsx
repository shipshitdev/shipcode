import { Button } from '@shipshitdev/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useCopyFeedback } from '../hooks/useCopyFeedback';
import { captureRendererException } from '../telemetry';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * Split out of the boundary itself because the shared copy-feedback hook — and its
 * unmount cleanup — cannot run inside a class component.
 */
function CopyTraceButton({ trace }: { trace: string }) {
  const { copied, copy } = useCopyFeedback({ resetMs: 2000 });

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => void copy(trace)}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
    >
      {copied ? (
        <>
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </Button>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
    void captureRendererException(error, {
      tags: { surface: 'renderer', kind: 'react-error-boundary' },
      extra: { componentStack: info.componentStack ?? null },
    });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  private getFullTrace(): string {
    const { error, componentStack } = this.state;
    if (!error) return '';
    const parts = [`${error.name}: ${error.message}`];
    if (error.stack) {
      const stackLines = error.stack
        .split('\n')
        .filter((l) => !l.includes(error.message))
        .join('\n');
      if (stackLines.trim()) parts.push(stackLines);
    }
    if (componentStack) {
      parts.push(`\nComponent Stack:${componentStack}`);
    }
    return parts.join('\n');
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const trace = this.getFullTrace();

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-primary p-8">
        <div className="flex w-full max-w-2xl flex-col items-center gap-5 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-500/10">
            <svg
              aria-hidden="true"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-red-500"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold text-red-400">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              A render error crashed the UI. Copy the trace below and paste it into Claude to debug.
            </p>
          </div>

          {trace && (
            <div className="w-full overflow-hidden rounded-lg border border-red-500/20 bg-red-500/5 text-left">
              <div className="flex items-center justify-end border-b border-red-500/15 px-3 py-2">
                <CopyTraceButton trace={trace} />
              </div>
              <pre className="max-h-64 w-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-red-300 select-text">
                {trace}
              </pre>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={this.handleDismiss}
              className="inline-flex items-center justify-center rounded-md border border-border bg-tertiary px-4 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-hover"
            >
              Dismiss
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-700"
            >
              Reload App
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
