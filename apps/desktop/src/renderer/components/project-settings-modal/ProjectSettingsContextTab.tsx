import { type ContextFileInfo, formatBytes } from '@shipcode/shared';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
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
    <div className="space-y-6">
      <section>
        <SettingsRow
          label="Memory Files"
          description="Repo memory is the pipeline's documented project context. Generate core files from repo docs; other .agents/memory/*.md files are loaded too."
        >
          <div className="flex min-w-[220px] flex-col gap-1.5">
            {managedFileNames.map((name) => {
              const file = contextFiles?.find((entry) => entry.name === name);
              return (
                <div key={name} className="flex items-center gap-2 text-xs">
                  {file?.exists ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                  ) : (
                    <span className="w-2 shrink-0 text-center text-muted-foreground">-</span>
                  )}
                  <span className="font-mono text-[12px] text-primary">{name}</span>
                  {file?.exists && file.size != null ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Generator CLI"
          description="Generated files are saved to .agents/memory/ and loaded with any other repo memory files."
        >
          <div className="flex items-center gap-2">
            <Select
              value={contextGeneratorCli}
              onValueChange={(value) => setContextGeneratorCli(value as ContextGeneratorCli)}
              disabled={contextGenerating}
            >
              <SelectTrigger className="w-[180px]">
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
            <Button
              variant="secondary"
              size="sm"
              onClick={onGenerateContext}
              disabled={contextGenerating || !!contextCliUnavailableReason}
            >
              <LoadingButtonContent loading={contextGenerating}>
                Generate Memory
              </LoadingButtonContent>
            </Button>
          </div>
        </SettingsRow>
        {contextError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
            <span className="line-clamp-2">{contextError}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
