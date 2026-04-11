import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface SettingsRowProps {
  label: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-border py-2.5 gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-primary cursor-pointer select-none">
            {label}
          </label>
        ) : (
          <span className="text-sm text-primary">{label}</span>
        )}
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
