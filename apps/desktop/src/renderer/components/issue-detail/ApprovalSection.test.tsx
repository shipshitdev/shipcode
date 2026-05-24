// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalSection } from './ApprovalSection';

vi.mock('@shipshitdev/ui', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label="approval action"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@shipshitdev/ui/common', () => ({
  LoadingButtonContent: ({ children, loading }: { children: ReactNode; loading?: boolean }) => (
    <>{loading ? 'Loading' : children}</>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ApprovalSection', () => {
  it('approves, requests changes with trimmed feedback, cancels, and shows approval errors', () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const onReject = vi.fn();
    const { rerender } = render(
      <ApprovalSection
        approveError="Plan content missing"
        canApprove={false}
        isSubmitting={false}
        onApprove={onApprove}
        onCancel={onCancel}
        onReject={onReject}
      />,
    );

    const confirm = screen.getByRole('button', { name: /confirm/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute(
      'title',
      'No plan content found - use Request Changes or Cancel',
    );
    expect(screen.getByText('Plan content missing')).toBeInTheDocument();
    expect(screen.getByText('(full trace in devtools console)')).toBeInTheDocument();

    rerender(
      <ApprovalSection
        approveError={null}
        canApprove
        isSubmitting={false}
        onApprove={onApprove}
        onCancel={onCancel}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('approval action'), {
      target: { value: 'request_changes' },
    });
    const feedback = screen.getByPlaceholderText(
      'Tell the planner what to change before the next pass...',
    );
    const resumeButton = screen.getByRole('button', { name: /resume planning with feedback/i });
    expect(resumeButton).toBeDisabled();

    fireEvent.change(feedback, { target: { value: '  tighten acceptance criteria  ' } });
    fireEvent.click(resumeButton);

    expect(onReject).toHaveBeenCalledWith('tighten acceptance criteria');
    expect(screen.queryByPlaceholderText(/Tell the planner/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('approval action'), {
      target: { value: 'cancel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables action selection and renders loading labels while submitting', () => {
    render(
      <ApprovalSection
        approveError={null}
        canApprove
        isSubmitting
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('approval action')).toBeDisabled();
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });
});
