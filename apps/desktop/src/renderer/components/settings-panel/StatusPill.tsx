import type { ReactNode } from 'react';

export function StatusPill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : tone === 'danger'
          ? 'border-red-500/30 bg-red-500/10 text-red-300'
          : 'border-border bg-tertiary text-secondary';

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
    >
      {children}
    </span>
  );
}
