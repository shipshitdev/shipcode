import type { StatusLabelMapping } from '@shipcode/shared';
import { StatusMappingEditor } from '@shipcode/ui';

interface Props {
  mappings: StatusLabelMapping;
  onChange: (mappings: StatusLabelMapping) => void;
}

export function StepLabelMapping({ mappings, onChange }: Props) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-2">Status label mapping</h3>
      <p className="text-secondary text-[13px] mb-4 leading-relaxed">
        Configure how pipeline statuses map to GitHub issue labels. The defaults work well for most
        projects.
      </p>
      <StatusMappingEditor mappings={mappings} onSave={onChange} />
    </div>
  );
}
