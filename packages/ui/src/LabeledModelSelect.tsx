import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/primitives/select';

export interface LabeledModelSelectOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface LabeledModelSelectProps<Value extends string = string> {
  id: string;
  label: string;
  value: Value;
  options: readonly LabeledModelSelectOption<Value>[];
  onValueChange: (value: Value) => void;
  className?: string;
  triggerClassName?: string;
}

export function LabeledModelSelect<Value extends string = string>({
  id,
  label,
  value,
  options,
  onValueChange,
  className,
  triggerClassName,
}: LabeledModelSelectProps<Value>) {
  return (
    <div data-slot="labeled-model-select" className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[11px] text-secondary">
        {label}
      </label>
      <Select value={value} onValueChange={(next) => onValueChange(next as Value)}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
