import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/primitives/select';
import { SettingsSection } from '@/SettingsSection';

export interface AppPickerOption<Value extends string = string> {
  value: Value;
  label: string;
  available: boolean;
  path: string | null;
  error: string | null;
}

export interface AppPickerSectionProps<Value extends string = string> {
  title: string;
  description: string;
  label: string;
  selectId: string;
  value: Value;
  options: readonly AppPickerOption<Value>[];
  onValueChange: (value: Value) => void;
  className?: string;
}

export function AppPickerSection<Value extends string = string>({
  title,
  description,
  label,
  selectId,
  value,
  options,
  onValueChange,
  className,
}: AppPickerSectionProps<Value>) {
  return (
    <SettingsSection title={title} description={description} className={className}>
      <div className="mb-4 flex max-w-[260px] flex-col gap-1.5">
        <label htmlFor={selectId} className="text-[11px] text-secondary">
          {label}
        </label>
        <Select value={value} onValueChange={(next) => onValueChange(next as Value)}>
          <SelectTrigger id={selectId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={!option.available}>
                {option.label}
                {!option.available ? ' (Unavailable)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {options.map((option) => (
          <div
            key={option.value}
            data-slot="app-picker-option"
            className="rounded-md border border-border bg-primary/40 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-[140px] text-[13px] font-medium text-primary">
                {option.label}
              </div>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                  option.available
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-border bg-tertiary text-secondary',
                )}
              >
                {option.available ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-[12px] text-secondary">
              {option.path ? (
                <div>
                  Path: <code>{option.path}</code>
                </div>
              ) : null}
              {option.error ? <div className="text-amber-300">{option.error}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
