import type { StatusLabelMapping } from '@shipcode/shared';
import { ArrowRight } from 'lucide-react';
import { Button } from './primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select';

interface StatusMappingEditorProps {
  mappings: StatusLabelMapping;
  onSave: (mappings: StatusLabelMapping) => void;
}

const PIPELINE_STATUSES = [
  { key: 'todo', label: 'Todo' },
  { key: 'queued', label: 'Queued' },
  { key: 'planning', label: 'Planning' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'revising', label: 'Revising' },
  { key: 'executing', label: 'Executing' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'shipping', label: 'Shipping' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

const PRESET_LABELS = ['status:queued', 'status:in-progress', 'status:done', 'status:failed'];

const NONE = '__none__';

export function StatusMappingEditor({ mappings, onSave }: StatusMappingEditorProps) {
  // Unique label values in use across the mapping (excluding empty)
  const activeLabels = [...new Set(Object.values(mappings).filter(Boolean))];
  // Merge presets + active values, deduplicated, sorted
  const options = [...new Set([...PRESET_LABELS, ...activeLabels])].sort();

  function handleChange(key: string, value: string) {
    onSave({ ...mappings, [key]: value === NONE ? '' : value });
  }

  function handleReset() {
    onSave({
      todo: '',
      queued: 'status:queued',
      planning: 'status:in-progress',
      reviewing: 'status:in-progress',
      revising: 'status:in-progress',
      awaiting_approval: 'status:in-progress',
      executing: 'status:in-progress',
      verifying: 'status:in-progress',
      shipping: 'status:in-progress',
      completed: 'status:done',
      failed: 'status:failed',
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="m-0 flex items-center gap-2 text-primary font-medium">
          Status
          <ArrowRight size={14} className="text-muted" />
          GitHub Label Mapping
        </h4>
        <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left p-2 text-secondary border-b border-border font-medium text-xs uppercase tracking-wide">
              Pipeline Status
            </th>
            <th className="text-left p-2 text-secondary border-b border-border font-medium text-xs uppercase tracking-wide">
              GitHub Label
            </th>
          </tr>
        </thead>
        <tbody>
          {PIPELINE_STATUSES.map(({ key, label }) => (
            <tr key={key} className="group">
              <td className="px-2 py-1.5 border-b border-border text-primary text-sm">{label}</td>
              <td className="px-2 py-1.5 border-b border-border">
                <Select
                  value={mappings[key] || NONE}
                  onValueChange={(v: string) => handleChange(key, v)}
                >
                  <SelectTrigger className="h-7 text-xs border-0 bg-transparent hover:bg-elevated focus:bg-elevated px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="text-xs text-muted">
                      (no label)
                    </SelectItem>
                    {options.map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-xs font-mono">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        Labels are auto-created on GitHub if they don't exist.
      </p>
    </div>
  );
}
