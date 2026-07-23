import { type ReactNode, useState } from 'react';
import { Button } from '@/primitives/button';

export interface SecureCredentialInputRenderProps {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export interface SecureCredentialFieldProps {
  ariaLabel: string;
  clearLabel: string;
  configured: boolean;
  placeholder: string;
  renderInput: (props: SecureCredentialInputRenderProps) => ReactNode;
  saveLabel: string;
  onClear: () => void;
  onSave: (value: string) => Promise<void>;
}

export function SecureCredentialField({
  ariaLabel,
  clearLabel,
  configured,
  placeholder,
  renderInput,
  saveLabel,
  onClear,
  onSave,
}: SecureCredentialFieldProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const value = draft.trim();
    if (!value) return;

    setError(null);
    try {
      await onSave(value);
      setDraft((current) => (current.trim() === value ? '' : current));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save credential');
    }
  };

  return (
    <div className="space-y-2">
      {renderInput({
        ariaLabel,
        placeholder,
        value: draft,
        onChange: setDraft,
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!draft.trim()}
          onClick={() => void save()}
        >
          {saveLabel}
        </Button>
        {configured ? (
          <Button type="button" variant="secondary" size="sm" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div role="alert" className="text-amber-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
