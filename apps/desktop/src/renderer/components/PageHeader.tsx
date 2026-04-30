import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-primary">{title}</h1>
        {subtitle && <p className="text-[13px] text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
