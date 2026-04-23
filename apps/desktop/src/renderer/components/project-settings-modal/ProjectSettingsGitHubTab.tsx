import {
  type GitHubLabelDefinition,
  SHIPCODE_AGENT_LABELS,
  SHIPCODE_CLASSIFICATION_LABELS,
  SHIPCODE_DEFAULT_LABELS,
  SHIPCODE_METADATA_LABELS,
  SHIPCODE_STATUS_LABELS,
} from '@shipcode/shared';
import { Button, LoadingButtonContent } from '@shipshitdev/ui';
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

export function ProjectSettingsGitHubTab({
  pathExists,
  projectId,
  isActive,
}: {
  pathExists: boolean;
  projectId: string;
  isActive: boolean;
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
      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="text-[12px] font-medium text-primary">Label management</div>
        <p className="mt-1 text-[11px] text-muted">
          ShipCode uses these labels to route issues to agents and track pipeline status. Sync to
          create any missing labels in your repo.
        </p>
      </div>

      {isLoading ? (
        <div className="text-[12px] text-muted">Loading repo labels…</div>
      ) : (
        <>
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
              title="Status"
              labels={SHIPCODE_STATUS_LABELS}
              existingNames={existingNames}
            />
            <LabelCategory
              title="Metadata"
              labels={SHIPCODE_METADATA_LABELS}
              existingNames={existingNames}
            />
          </div>

          <div className="flex items-center gap-3">
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

            {syncMutation.isSuccess && syncMutation.data ? (
              <span className="text-[11px] text-muted">
                Created {syncMutation.data.created.length}
                {syncMutation.data.failed.length > 0
                  ? `, ${syncMutation.data.failed.length} failed`
                  : ''}
              </span>
            ) : null}
          </div>

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
