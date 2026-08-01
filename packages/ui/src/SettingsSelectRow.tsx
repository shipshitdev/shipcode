import { SettingsRow } from '@shipshitdev/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/primitives/select';

export interface SettingsSelectRowOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface SettingsSelectRowProps<Value extends string = string> {
  id?: string;
  label: string;
  description?: string;
  value: Value;
  options: readonly SettingsSelectRowOption<Value>[];
  onValueChange: (value: Value) => void;
  className?: string;
  triggerClassName?: string;
}

export function SettingsSelectRow<Value extends string = string>({
  id,
  label,
  description,
  value,
  options,
  onValueChange,
  className,
  triggerClassName,
}: SettingsSelectRowProps<Value>) {
  return (
    <SettingsRow label={label} htmlFor={id} description={description} className={className}>
      <Select value={value} onValueChange={(next) => onValueChange(next as Value)}>
        <SelectTrigger data-slot="settings-select-row" id={id} className={triggerClassName}>
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
    </SettingsRow>
  );
}
