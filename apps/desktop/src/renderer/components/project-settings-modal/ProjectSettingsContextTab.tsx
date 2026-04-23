import type { ContextFileInfo } from '@shipcode/shared';
import {
  Button,
  Label,
  LoadingButtonContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';
import type { ContextGeneratorCli } from './shared';

export function ProjectSettingsContextTab({
  contextFiles,
  contextGeneratorCli,
  setContextGeneratorCli,
  contextGenerating,
  contextCliUnavailableReason,
  contextError,
  cliOptions,
  onGenerateContext,
}: {
  contextFiles: ContextFileInfo[] | undefined;
  contextGeneratorCli: ContextGeneratorCli;
  setContextGeneratorCli: (value: ContextGeneratorCli) => void;
  contextGenerating: boolean;
  contextCliUnavailableReason: string | null;
  contextError: string | null;
  cliOptions: Array<{
    value: ContextGeneratorCli;
    label: string;
    disabledReason: string | null;
  }>;
  onGenerateContext: () => void;
}) {
  const managedFileNames = ['goal.md', 'architecture.md', 'constraints.md', 'do-dont.md'] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-secondary">Memory Files</Label>
        <p className="text-[11px] text-muted">
          Repo memory is the pipeline&apos;s documented project context. Generate the core files
          below from your repo&apos;s README, package.json, AGENTS.md, and CLAUDE.md. Any other{' '}
          <span className="font-mono">.agents/memory/*.md</span> files in the repo are loaded too.
        </p>
        <div className="flex flex-col gap-1.5">
          {managedFileNames.map((name) => {
            const file = contextFiles?.find((entry) => entry.name === name);
            return (
              <div key={name} className="flex items-center gap-2 text-xs">
                {file?.exists ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                ) : (
                  <span className="w-2 shrink-0 text-center text-muted">-</span>
                )}
                <span className="font-mono text-[12px] text-primary">{name}</span>
                {file?.exists && file.size != null ? (
                  <span className="ml-auto text-[11px] text-muted">
                    {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex items-end gap-2">
          <div className="flex min-w-[180px] flex-col gap-1.5">
            <Label className="text-[11px] text-secondary">Generator CLI</Label>
            <Select
              value={contextGeneratorCli}
              onValueChange={(value) => setContextGeneratorCli(value as ContextGeneratorCli)}
              disabled={contextGenerating}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cliOptions.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={!!option.disabledReason}
                  >
                    {option.label}
                    {option.disabledReason ? ` (${option.disabledReason})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onGenerateContext}
            disabled={contextGenerating || !!contextCliUnavailableReason}
          >
            <LoadingButtonContent loading={contextGenerating}>Generate Memory</LoadingButtonContent>
          </Button>
        </div>
        <p className="text-[11px] text-muted">
          Generated files are saved to <span className="font-mono">.agents/memory/</span> and loaded
          alongside any other repo memory files already in that folder.
        </p>
        {contextError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
            <span className="line-clamp-2">{contextError}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
