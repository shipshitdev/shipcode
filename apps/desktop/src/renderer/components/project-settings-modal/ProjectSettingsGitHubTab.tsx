import {
  type GhStatusMapping,
  type GitHubLabelDefinition,
  SHIPCODE_AGENT_LABELS,
  SHIPCODE_CLASSIFICATION_LABELS,
  SHIPCODE_DEFAULT_LABELS,
  SHIPCODE_METADATA_LABELS,
  SHIPCODE_PIPELINE_LABELS,
} from '@shipcode/shared';
import { Button, SettingsRow } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

interface LabelCategoryProps {
  title: string;
  labels: readonly GitHubLabelDefinition[];
  existingNames: Set<string>;
}

function LabelCategory({ title, labels, existingNames }: LabelCategoryProps) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-medium text-primary">{title}</div>
      <div className="space-y-1">
        {labels.map((label) => {
          const isPresent = existingNames.has(label.name);
          return (
            <div key={label.name} className="flex items-center gap-2 text-[12px]">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: `#${label.color}` }}
              />
              <span className={isPresent ? 'text-primary' : 'text-muted'}>{label.name}</span>
              {isPresent ? (
                <span className="text-[10px] text-success">present</span>
              ) : (
                <span className="text-[10px] text-muted">missing</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status column mapping display
// ---------------------------------------------------------------------------

const MACRO_COLUMNS: Array<{
  key: keyof GhStatusMapping;
  label: string;
  description: string;
}> = [
  { key: 'todo', label: 'Todo', description: 'Backlog / not started' },
  { key: 'inProgress', label: 'In Progress', description: 'Agent loop running' },
  { key: 'humanReview', label: 'Human Review', description: 'Awaiting manual review' },
  { key: 'done', label: 'Done', description: 'Completed / shipped' },
];

function StatusColumnMapping({
  mapping,
  hasProjectUrl,
}: {
  mapping: GhStatusMapping | null;
  hasProjectUrl: boolean;
}) {
  if (!hasProjectUrl) {
    return (
      <div className="text-[12px] text-muted">
        Set a GitHub Project URL in the General tab to enable board column sync.
      </div>
    );
  }

  if (!mapping) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
        Status field mapping not detected. Re-save the GitHub Project URL in the General tab to
        trigger auto-detection, or verify your board has a &quot;Status&quot; single-select field.
      </div>
    );
  }

  const mapped = MACRO_COLUMNS.filter((c) => mapping[c.key] !== null);
  const unmapped = MACRO_COLUMNS.filter((c) => mapping[c.key] === null);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {mapped.map((col) => (
          <div key={col.key} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" />
            <span className="font-medium text-primary">{col.label}</span>
            <span className="text-muted">→</span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-primary">
              {mapping[col.key]}
            </span>
          </div>
        ))}
        {unmapped.map((col) => (
          <div key={col.key} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" />
            <span className="font-medium text-muted">{col.label}</span>
            <span className="text-[10px] text-warning">not mapped</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectSettingsGitHubTab({
  pathExists,
  projectId,
  isActive,
  statusMapping,
  hasProjectUrl,
}: {
  pathExists: boolean;
  projectId: string;
  isActive: boolean;
  statusMapping: GhStatusMapping | null;
  hasProjectUrl: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: repoLabels, isLoading } = useQuery<
    Array<{ name: string; color: string; description: string }>
  >({
    queryKey: ['repo-labels', projectId],
    queryFn: () => window.shipcode.invoke('github:list-repo-labels', { projectId }),
    enabled: pathExists && isActive,
    staleTime: 0,
  });

  const existingNames = useMemo(() => new Set(repoLabels?.map((l) => l.name) ?? []), [repoLabels]);

  const missingCount = useMemo(
    () => SHIPCODE_DEFAULT_LABELS.filter((l) => !existingNames.has(l.name)).length,
    [existingNames],
  );

  const syncMutation = useMutation<{
    created: string[];
    alreadyPresent: string[];
    failed: Array<{ name: string; error: string }>;
  }>({
    mutationFn: () => window.shipcode.invoke('github:ensure-shipcode-labels', { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-labels', projectId] });
    },
  });

  if (!pathExists) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
        This project's repository folder is missing. Relink it in the General tab before managing
        labels.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted">
        ShipCode uses these labels to route issues to agents and attach concise metadata. Workflow
        state belongs in the typed GitHub Projects Status field.
      </div>

      {isLoading ? (
        <div className="text-[12px] text-muted">Loading repo labels…</div>
      ) : (
        <>
          <SettingsRow
            label="Board column sync"
            description="Maps ShipCode pipeline columns to your GitHub Projects v2 Status field."
          >
            <StatusColumnMapping mapping={statusMapping} hasProjectUrl={hasProjectUrl} />
          </SettingsRow>

          <div className="grid gap-4 md:grid-cols-2">
            <LabelCategory
              title="Classification"
              labels={SHIPCODE_CLASSIFICATION_LABELS}
              existingNames={existingNames}
            />
            <LabelCategory
              title="Agent routing"
              labels={SHIPCODE_AGENT_LABELS}
              existingNames={existingNames}
            />
            <LabelCategory
              title="System"
              labels={SHIPCODE_METADATA_LABELS}
              existingNames={existingNames}
            />
            <LabelCategory
              title="Pipeline state"
              labels={SHIPCODE_PIPELINE_LABELS}
              existingNames={existingNames}
            />
          </div>

          <SettingsRow
            label="Label sync"
            description="Create any missing ShipCode labels in the connected GitHub repo."
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || missingCount === 0}
            >
              <LoadingButtonContent loading={syncMutation.isPending}>
                {missingCount === 0
                  ? 'All labels present'
                  : `Sync ${missingCount} missing label${missingCount === 1 ? '' : 's'}`}
              </LoadingButtonContent>
            </Button>
          </SettingsRow>

          {syncMutation.isSuccess && syncMutation.data ? (
            <div className="text-[11px] text-muted">
              Created {syncMutation.data.created.length}
              {syncMutation.data.failed.length > 0
                ? `, ${syncMutation.data.failed.length} failed`
                : ''}
            </div>
          ) : null}

          {syncMutation.isError ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {String(syncMutation.error)}
            </div>
          ) : null}

          {syncMutation.data?.failed && syncMutation.data.failed.length > 0 ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <div className="font-medium">Failed labels:</div>
              <ul className="mt-1 space-y-0.5">
                {syncMutation.data.failed.map((f: { name: string; error: string }) => (
                  <li key={f.name}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
