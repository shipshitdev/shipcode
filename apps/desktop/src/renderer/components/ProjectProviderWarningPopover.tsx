import type { AppSettings, Project, ProjectProviderWarning } from '@shipcode/shared';
import { getPhaseDescriptor, resolvePhaseModel, resolvePhaseModelId } from '@shipcode/shared';
import { Badge, Button, cn, Popover, PopoverContent, PopoverTrigger } from '@shipcode/ui';
import { formatProviderSelectionLabel, PROVIDER_DISPLAY } from './model-provider-options';

function formatResolvedSelection(
  settings: AppSettings,
  project: Project,
  phase: ProjectProviderWarning['phase'],
) {
  const provider = resolvePhaseModel(settings, project, phase);
  const modelId = resolvePhaseModelId(settings, project, phase);
  return modelId
    ? formatProviderSelectionLabel(provider, modelId)
    : `${PROVIDER_DISPLAY[provider]} default`;
}

export function ProjectProviderWarningPopover({
  settings,
  project,
  warnings,
  className,
}: {
  settings: AppSettings;
  project: Project;
  warnings: ProjectProviderWarning[];
  className?: string;
}) {
  const hasBlockedWarning = warnings.some((warning) => warning.severity === 'blocked');
  const label = hasBlockedWarning ? 'Blocked' : 'Low';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Project model warnings for ${project.name}`}
          className={cn('h-auto p-0 hover:bg-transparent', className)}
        >
          <Badge
            variant="warning"
            className={cn(
              'shrink-0 text-[10px]',
              hasBlockedWarning && 'border-danger/30 bg-danger/10 text-danger',
            )}
          >
            {label}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[360px] bg-elevated p-2 shadow-lg">
        <div className="mb-2 px-1">
          <div className="text-[11px] font-medium text-primary">Selected models vs CLI status</div>
          <div className="text-[10px] text-muted">
            These phases are configured to use providers that are currently blocked or running low.
          </div>
        </div>
        <div className="space-y-2">
          {warnings.map((warning) => {
            const phases = warning.phases?.length ? warning.phases : [warning.phase];

            return (
              <div
                key={`${warning.provider}:${warning.message}:${phases.join(',')}`}
                className={cn(
                  'rounded-md border px-2.5 py-2',
                  warning.severity === 'blocked'
                    ? 'border-danger/25 bg-danger/5'
                    : 'border-warning/25 bg-warning/5',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-primary">{warning.message}</div>
                  <Badge
                    variant="warning"
                    className={cn(
                      'shrink-0 text-[10px]',
                      warning.severity === 'blocked' && 'border-danger/30 bg-danger/10 text-danger',
                    )}
                  >
                    {warning.severity}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {phases.map((phase) => (
                    <div
                      key={phase}
                      className="flex items-start justify-between gap-3 rounded border border-border/60 bg-secondary/30 px-2 py-1.5"
                    >
                      <div className="text-[11px] font-medium text-secondary">
                        {getPhaseDescriptor(phase).label}
                      </div>
                      <div className="min-w-0 text-right text-[11px] text-primary">
                        {formatResolvedSelection(settings, project, phase)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
