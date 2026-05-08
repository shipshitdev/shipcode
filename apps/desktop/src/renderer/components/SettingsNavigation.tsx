import { Button, cn } from '@shipshitdev/ui';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SettingsNavigationItem<TKey extends string> {
  key: TKey;
  label: string;
  icon: ReactNode;
}

interface SettingsNavigationProps<TKey extends string> {
  items: readonly SettingsNavigationItem<TKey>[];
  activeKey: TKey;
  onSelect: (key: TKey) => void;
  backLabel?: string;
  onBack?: () => void;
  className?: string;
}

export function SettingsNavigation<TKey extends string>({
  items,
  activeKey,
  onSelect,
  backLabel,
  onBack,
  className,
}: SettingsNavigationProps<TKey>) {
  return (
    <aside
      className={cn(
        'flex w-[256px] min-w-[256px] flex-col border-r border-border bg-primary',
        className,
      )}
    >
      {backLabel && onBack ? (
        <div className="px-2 pt-3">
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag"
            onClick={onBack}
          >
            <span className="shrink-0 text-muted-foreground">
              <ChevronLeft size={14} />
            </span>
            {backLabel}
          </Button>
        </div>
      ) : null}

      <div className={cn('space-y-0.5', backLabel && onBack ? 'mt-0.5 px-2' : 'px-2 pt-3')}>
        {items.map(({ key, label, icon }) => (
          <Button
            variant="ghost"
            key={key}
            className={cn(
              'h-auto w-full justify-start gap-2 pl-3 pr-5 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              activeKey === key && 'bg-tertiary text-primary',
            )}
            onClick={() => onSelect(key)}
          >
            <span className="shrink-0 text-muted-foreground">{icon}</span>
            {label}
          </Button>
        ))}
      </div>
    </aside>
  );
}
