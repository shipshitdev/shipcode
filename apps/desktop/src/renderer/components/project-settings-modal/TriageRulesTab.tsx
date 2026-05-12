import {
  clampError,
  TRIAGE_RULE_LIMIT,
  type TriageRule,
  type TriageRuleCondition,
  type TriageRuleConditionKind,
  type TriageRuleDraft,
} from '@shipcode/shared';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Switch,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type EditableTriageRuleCondition = TriageRuleCondition & { clientId: string };
type EditableTriageRule = Omit<TriageRuleDraft, 'conditions'> & {
  clientId: string;
  conditions: Omit<TriageRuleDraft['conditions'], 'items'> & {
    items: EditableTriageRuleCondition[];
  };
};

const CONDITION_KIND_LABELS: Record<TriageRuleConditionKind, string> = {
  label_includes: 'Label includes',
  label_excludes: 'Label excludes',
  title_contains: 'Title contains',
};

function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${Math.random()}`;
}

function toEditableRule(rule: TriageRule): EditableTriageRule {
  return {
    id: rule.id,
    clientId: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    conditions: {
      operator: rule.conditions.operator,
      items: rule.conditions.items.map((condition) => ({
        ...condition,
        clientId: newClientId(),
      })),
    },
    actions: {
      addLabels: [...rule.actions.addLabels],
      removeLabels: [...rule.actions.removeLabels],
    },
  };
}

function createRule(): EditableTriageRule {
  return {
    clientId: newClientId(),
    name: 'New rule',
    enabled: true,
    conditions: {
      operator: 'all',
      items: [{ clientId: newClientId(), kind: 'title_contains', value: '' }],
    },
    actions: {
      addLabels: [],
      removeLabels: [],
    },
  };
}

function labelsToText(labels: readonly string[]): string {
  return labels.join(', ');
}

function textToLabels(value: string): string[] {
  return value.split(',').flatMap((label) => {
    const trimmed = label.trim();
    return trimmed ? [trimmed] : [];
  });
}

function toDraft(rule: EditableTriageRule): TriageRuleDraft {
  return {
    ...(rule.id ? { id: rule.id } : {}),
    name: rule.name,
    enabled: rule.enabled,
    conditions: {
      operator: rule.conditions.operator,
      items: rule.conditions.items.map(({ kind, value }) => ({ kind, value })),
    },
    actions: {
      addLabels: [...rule.actions.addLabels],
      removeLabels: [...rule.actions.removeLabels],
    },
  };
}

function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function TriageRuleCard({
  rule,
  ruleIndex,
  rulesCount,
  onUpdate,
  onDelete,
  onMove,
}: {
  rule: EditableTriageRule;
  ruleIndex: number;
  rulesCount: number;
  onUpdate: (index: number, updater: (rule: EditableTriageRule) => EditableTriageRule) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  function updateCondition(conditionIndex: number, patch: Partial<TriageRuleCondition>) {
    onUpdate(ruleIndex, (current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        items: replaceAt(current.conditions.items, conditionIndex, {
          ...current.conditions.items[conditionIndex],
          ...patch,
        }),
      },
    }));
  }

  function addCondition() {
    onUpdate(ruleIndex, (current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        items: [
          ...current.conditions.items,
          { clientId: newClientId(), kind: 'title_contains', value: '' },
        ],
      },
    }));
  }

  function removeCondition(conditionIndex: number) {
    onUpdate(ruleIndex, (current) => ({
      ...current,
      conditions: {
        ...current.conditions,
        items: current.conditions.items.filter((_, index) => index !== conditionIndex),
      },
    }));
  }

  return (
    <div className="rounded-md border border-border bg-secondary/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`triage-rule-name-${rule.clientId}`} className="text-[11px]">
            Name
          </Label>
          <Input
            id={`triage-rule-name-${rule.clientId}`}
            value={rule.name}
            onChange={(event) =>
              onUpdate(ruleIndex, (current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            className="mt-1"
          />
        </div>
        <div className="flex items-center gap-1.5 pt-5">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(checked) =>
              onUpdate(ruleIndex, (current) => ({ ...current, enabled: checked }))
            }
            aria-label={`Enable ${rule.name || 'triage rule'}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Move rule up"
            aria-label="Move rule up"
            onClick={() => onMove(ruleIndex, -1)}
            disabled={ruleIndex === 0}
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Move rule down"
            aria-label="Move rule down"
            onClick={() => onMove(ruleIndex, 1)}
            disabled={ruleIndex === rulesCount - 1}
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Delete rule"
            aria-label="Delete rule"
            onClick={() => onDelete(ruleIndex)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-primary">Conditions</div>
            <div className="text-[11px] text-muted-foreground">
              {rule.conditions.operator === 'all'
                ? 'Every condition must match.'
                : 'Any condition can match.'}
            </div>
          </div>
          <Select
            value={rule.conditions.operator}
            onValueChange={(value) =>
              onUpdate(ruleIndex, (current) => ({
                ...current,
                conditions: {
                  ...current.conditions,
                  operator: value === 'any' ? 'any' : 'all',
                },
              }))
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="any">Any</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {rule.conditions.items.map((condition, conditionIndex) => (
            <div key={condition.clientId} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
              <Select
                value={condition.kind}
                onValueChange={(value) =>
                  updateCondition(conditionIndex, {
                    kind: value as TriageRuleConditionKind,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDITION_KIND_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={condition.value}
                onChange={(event) =>
                  updateCondition(conditionIndex, {
                    value: event.target.value,
                  })
                }
                placeholder={condition.kind === 'title_contains' ? 'bug' : 'complexity:low'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Delete condition"
                aria-label="Delete condition"
                onClick={() => removeCondition(conditionIndex)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="xs" onClick={addCondition}>
            <Plus size={12} />
            Condition
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`triage-add-labels-${rule.clientId}`} className="text-[11px]">
            Add labels
          </Label>
          <Input
            id={`triage-add-labels-${rule.clientId}`}
            value={labelsToText(rule.actions.addLabels)}
            onChange={(event) =>
              onUpdate(ruleIndex, (current) => ({
                ...current,
                actions: {
                  ...current.actions,
                  addLabels: textToLabels(event.target.value),
                },
              }))
            }
            placeholder="agent:claude, complexity:low"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`triage-remove-labels-${rule.clientId}`} className="text-[11px]">
            Remove labels
          </Label>
          <Input
            id={`triage-remove-labels-${rule.clientId}`}
            value={labelsToText(rule.actions.removeLabels)}
            onChange={(event) =>
              onUpdate(ruleIndex, (current) => ({
                ...current,
                actions: {
                  ...current.actions,
                  removeLabels: textToLabels(event.target.value),
                },
              }))
            }
            placeholder="status:needs-triage"
          />
        </div>
      </div>
    </div>
  );
}

export function TriageRulesTab({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<EditableTriageRule[]>([]);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  };
  const [saveError, setSaveError] = useState<string | null>(null);

  const rulesQuery = useQuery<TriageRule[]>({
    queryKey: ['project-triage-rules', projectId],
    queryFn: () => window.shipcode.invoke('project:list-triage-rules', { projectId }),
    enabled: isActive && !!projectId,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId triggers reset when switching projects
  useEffect(() => {
    if (dirtyRef.current && rulesQuery.data) return;
    setRules(rulesQuery.data ? rulesQuery.data.map(toEditableRule) : []);
    dirtyRef.current = false;
    setDirtyState(false);
    setSaveError(null);
  }, [projectId, rulesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      window.shipcode.invoke('project:replace-triage-rules', {
        projectId,
        rules: rules.map(toDraft),
      }),
    onSuccess: (saved) => {
      setRules(saved.map(toEditableRule));
      setDirty(false);
      setSaveError(null);
      queryClient.setQueryData(['project-triage-rules', projectId], saved);
    },
    onError: (err: unknown) => {
      log.error('[TriageRulesTab] save failed', err);
      setSaveError(clampError(err));
    },
  });

  const canAdd = rules.length < TRIAGE_RULE_LIMIT;
  const enabledCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);

  function updateRule(index: number, updater: (rule: EditableTriageRule) => EditableTriageRule) {
    setRules((current) => replaceAt(current, index, updater(current[index])));
    setDirty(true);
    setSaveError(null);
  }

  function deleteRule(index: number) {
    setRules((current) => current.filter((_, i) => i !== index));
    setDirty(true);
    setSaveError(null);
  }

  function moveRule(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rules.length) return;
    setRules((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setDirty(true);
    setSaveError(null);
  }

  if (rulesQuery.isLoading) {
    return <div className="text-[12px] text-muted-foreground">Loading triage rules…</div>;
  }

  if (rulesQuery.error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {clampError(rulesQuery.error)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-muted-foreground">
        Rules run once for each newly discovered GitHub issue. The first enabled match wins.
      </div>

      <SettingsRow
        label="Rules"
        description={`${enabledCount} enabled / ${rules.length} total. New issues with no match are marked as evaluated.`}
      >
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!canAdd) return;
              setRules((current) => [...current, createRule()]);
              setDirty(true);
              setSaveError(null);
            }}
            disabled={!canAdd}
          >
            <Plus size={14} />
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            <LoadingButtonContent loading={saveMutation.isPending}>
              <Save size={14} />
              Save
            </LoadingButtonContent>
          </Button>
        </div>
      </SettingsRow>

      {rules.length >= TRIAGE_RULE_LIMIT ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          This project has the maximum {TRIAGE_RULE_LIMIT} triage rules.
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {saveError}
        </div>
      ) : null}

      {rules.length === 0 ? (
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-4 text-[12px] text-muted-foreground">
          No triage rules configured.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, ruleIndex) => (
            <TriageRuleCard
              key={rule.clientId}
              rule={rule}
              ruleIndex={ruleIndex}
              rulesCount={rules.length}
              onUpdate={updateRule}
              onDelete={deleteRule}
              onMove={moveRule}
            />
          ))}
        </div>
      )}
    </div>
  );
}
