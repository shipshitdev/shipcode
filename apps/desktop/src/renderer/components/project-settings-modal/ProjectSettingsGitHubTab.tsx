import {
  type GhStatusMapping,
  type GitHubLabelDefinition,
  type ProjectReadinessItem,
  type ProjectReadinessReport,
  SHIPCODE_AGENT_LABELS,
  SHIPCODE_CLASSIFICATION_LABELS,
  SHIPCODE_DEFAULT_LABELS,
  SHIPCODE_METADATA_LABELS,
  SHIPCODE_PIPELINE_LABELS,
} from '@shipcode/shared';
import { Badge, Button, SettingsRow } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
              {mapping[col.key]?.name}
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

function readinessVariant(status: ProjectReadinessItem['status']) {
  if (status === 'ready') return 'success' as const;
  if (status === 'warning') return 'warning' as const;
  return 'danger' as const;
}

function ReadinessItemRow({ item }: { item: ProjectReadinessItem }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-primary">{item.label}</div>
          <div className="mt-0.5 text-[11px] text-muted">{item.message}</div>
        </div>
        <Badge variant={readinessVariant(item.status)}>{item.status}</Badge>
      </div>
      {item.missing && item.missing.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.missing.map((value) => (
            <span
              key={value}
              className="rounded-sm bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning"
            >
              {value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectReadinessSummary({
  readiness,
  loading,
  fetching,
  error,
  onRefresh,
}: {
  readiness: ProjectReadinessReport | undefined;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  if (loading) {
    return <div className="text-[12px] text-muted">Checking GitHub readiness...</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {String(error)}
      </div>
    );
  }

  if (!readiness) return null;

  const requiredItems = readiness.items.filter((item) => item.required);
  const optionalItems = readiness.items.filter((item) => !item.required);

  return (
    <div className="space-y-3">
      <SettingsRow
        label="Project readiness"
        description="ShipCode labels are repaired automatically; issue metadata is validated against GitHub issue types and Projects fields."
      >
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={fetching}>
          <LoadingButtonContent loading={fetching}>
            {readiness.ok ? 'Ready' : 'Re-check'}
          </LoadingButtonContent>
        </Button>
      </SettingsRow>

      <div className="grid gap-2">
        {requiredItems.map((item) => (
          <ReadinessItemRow key={item.key} item={item} />
        ))}
        {optionalItems.map((item) => (
          <ReadinessItemRow key={item.key} item={item} />
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

  const readinessQuery = useQuery<ProjectReadinessReport>({
    queryKey: ['project-readiness', projectId],
    queryFn: () => window.shipcode.invoke('github:check-project-readiness', { projectId }),
    enabled: pathExists && isActive,
    staleTime: 0,
  });

  const existingNames = useMemo(
    () => new Set(readinessQuery.data?.labelNames ?? []),
    [readinessQuery.data?.labelNames],
  );

  const missingCount = useMemo(
    () => SHIPCODE_DEFAULT_LABELS.filter((l) => !existingNames.has(l.name)).length,
    [existingNames],
  );

  const mappedStatus = readinessQuery.data?.statusMapping ?? statusMapping;

  async function refreshReadiness() {
    await readinessQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  }

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
        ShipCode owns only the <code>shipcode:*</code> labels. Type, priority, complexity, blast
        radius, and product taxonomy belong in GitHub issue types and Projects fields.
      </div>

      {readinessQuery.isLoading ? (
        <div className="text-[12px] text-muted">Checking GitHub readiness...</div>
      ) : (
        <>
          <ProjectReadinessSummary
            readiness={readinessQuery.data}
            loading={readinessQuery.isLoading}
            fetching={readinessQuery.isFetching}
            error={readinessQuery.error}
            onRefresh={() => {
              void refreshReadiness();
            }}
          />

          <SettingsRow
            label="Board column sync"
            description="Maps ShipCode pipeline columns to your GitHub Projects v2 Status field."
          >
            <StatusColumnMapping mapping={mappedStatus} hasProjectUrl={hasProjectUrl} />
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
            description="Readiness checks create missing ShipCode labels automatically."
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void refreshReadiness();
              }}
              disabled={readinessQuery.isFetching || missingCount === 0}
            >
              <LoadingButtonContent loading={readinessQuery.isFetching}>
                {missingCount === 0
                  ? 'All labels present'
                  : `Sync ${missingCount} missing label${missingCount === 1 ? '' : 's'}`}
              </LoadingButtonContent>
            </Button>
          </SettingsRow>

          {readinessQuery.data?.labelSync.created.length ? (
            <div className="text-[11px] text-muted">
              Created {readinessQuery.data.labelSync.created.length} missing ShipCode label
              {readinessQuery.data.labelSync.created.length === 1 ? '' : 's'}.
            </div>
          ) : null}

          {readinessQuery.isError ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {String(readinessQuery.error)}
            </div>
          ) : null}

          {readinessQuery.data?.labelSync.failed &&
          readinessQuery.data.labelSync.failed.length > 0 ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              <div className="font-medium">Failed labels:</div>
              <ul className="mt-1 space-y-0.5">
                {readinessQuery.data.labelSync.failed.map((f: { name: string; error: string }) => (
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
