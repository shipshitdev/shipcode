import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';

export type StatCardTone = 'default' | 'agent' | 'success' | 'warn' | 'danger';

export type StatCardProps = {
  label: string;
  value: number | string;
  subtitle?: string;
  icon?: ReactNode;
  tone?: StatCardTone;
  className?: string;
};

const toneClasses: Record<StatCardTone, string> = {
  default: '',
  agent: 'border-agent/35 bg-agent/[0.04]',
  success: 'border-success/40 bg-success/5',
  warn: 'border-warning/40 bg-warning/5',
  danger: 'border-danger/40 bg-danger/5',
};

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  tone = 'default',
  className,
}: StatCardProps) {
  return (
    <Card className={cn('h-full', toneClasses[tone], className)}>
      <CardContent className="p-5 pt-5">
        <div className="flex items-start justify-between">
          <div className="text-3xl font-semibold tracking-[-0.04em] text-primary">{value}</div>
          {icon ? <div className="text-secondary">{icon}</div> : null}
        </div>
        <div className="mt-1 text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
          {label}
        </div>
        {subtitle ? (
          <div className="mt-2 text-[11px] leading-5 text-secondary">{subtitle}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
