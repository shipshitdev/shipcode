import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  const hasHeader = title || description;

  return (
    <section data-slot="settings-section" className={cn('mb-8', className)}>
      {hasHeader ? (
        <div className="mb-3">
          {title ? <h4 className="text-[13px] font-medium text-secondary">{title}</h4> : null}
          {description ? <p className="mt-1 text-[11px] text-muted">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
