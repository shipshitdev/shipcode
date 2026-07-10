import {
  type AgentType,
  type Automation,
  type CreateAutomationInput,
  clampError,
  type Project,
  type ReasoningEffort,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import { CollapsibleSection } from '@shipcode/ui';
import {
  Button,
  Input,
  Keycap,
  Label,
  Modal,
  ModalFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cron } from 'croner';
import log from 'electron-log/renderer';
import { Wand2 } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useAppStore } from '../../stores/app-store';
import {
  executorModelPlaceholder,
  executorModelSuggestions,
  executorReasoningOptions,
} from './executor-model-options';

const PRESETS: Array<{ id: string; label: string; cron: string | null }> = [
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: '4h', label: 'Every 4 hours', cron: '0 */4 * * *' },
  { id: 'daily-9', label: 'Daily at 09:00 UTC', cron: '0 9 * * *' },
  { id: 'weekly-mon-9', label: 'Weekly Monday 09:00 UTC', cron: '0 9 * * 1' },
  { id: 'custom', label: 'Custom…', cron: null },
];

const PROVIDER_OPTIONS: Array<{ value: 'inherit' | AgentType; label: string }> = [
  { value: 'inherit', label: 'Inherit from project' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'openrouter', label: 'OpenRouter' },
];

interface FormatAutomationVariables {
  requestId: number;
  formKey: string;
  projectId: string;
  prompt: string;
  provider: 'inherit' | AgentType;
  modelId: string;
  reasoning: 'inherit' | ReasoningEffort;
}

interface AutomationFormState {
  projectIds: string[];
  name: string;
  prompt: string;
  presetId: string;
  customCron: string;
  enabled: boolean;
  provider: 'inherit' | AgentType;
  executorModelId: string;
  reasoning: 'inherit' | ReasoningEffort;
  error: string | null;
}

type AutomationFormAction =
  | { type: 'load'; form: AutomationFormState }
  | { type: 'ensure-project'; projectId: string }
  | {
      type: 'field';
      field: keyof AutomationFormState;
      value: AutomationFormState[keyof AutomationFormState];
    };

const INITIAL_AUTOMATION_FORM_STATE: AutomationFormState = {
  projectIds: [],
  name: '',
  prompt: '',
  presetId: 'hourly',
  customCron: '',
  enabled: true,
  provider: 'inherit',
  executorModelId: '',
  reasoning: 'inherit',
  error: null,
};

function automationFormReducer(
  state: AutomationFormState,
  action: AutomationFormAction,
): AutomationFormState {
  switch (action.type) {
    case 'load':
      return action.form;
    case 'ensure-project':
      return state.projectIds.length > 0 ? state : { ...state, projectIds: [action.projectId] };
    case 'field':
      return { ...state, [action.field]: action.value };
  }
}

function presetForCron(cron: string): string {
  const found = PRESETS.find((p) => p.cron === cron);
  return found ? found.id : 'custom';
}

function validateCron(expr: string): string | null {
  if (!expr.trim()) return 'Cron expression required';
  try {
    new Cron(expr, { paused: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid cron expression';
  }
}

function useCreateAutomationModalView() {
  const queryClient = useQueryClient();
  const open = useAppStore((s) => s.createAutomationModalOpen);
  const editingId = useAppStore((s) => s.editingAutomationId);
  const close = useAppStore((s) => s.closeCreateAutomationModal);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const initializedFormKeyRef = useRef<string | null>(null);
  const nextFormatRequestIdRef = useRef(0);
  const latestFormatRequestRef = useRef<{ id: number; formKey: string } | null>(null);

  const isEdit = editingId !== null;
  const currentFormKey = isEdit ? `edit:${editingId}` : 'create';

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list-visible'),
    enabled: open,
  });

  const { data: existing } = useQuery<Automation | null>({
    queryKey: ['automation', editingId],
    queryFn: () => {
      if (editingId === null) return null;
      return window.shipcode.invoke<Automation | null>('automations:get', { id: editingId });
    },
    enabled: open && isEdit,
  });

  const [form, dispatchForm] = useReducer(automationFormReducer, INITIAL_AUTOMATION_FORM_STATE);
  const {
    projectIds,
    name,
    prompt,
    presetId,
    customCron,
    enabled,
    provider,
    executorModelId,
    reasoning,
    error,
  } = form;

  const reasoningOptions = useMemo(
    () => executorReasoningOptions(provider, executorModelId),
    [provider, executorModelId],
  );

  // A provider/model change can strand a previously valid effort (e.g. None
  // after switching to Fable 5, whose thinking cannot be disabled) — fall back
  // to inherit instead of persisting a selection the pipeline would reject.
  useEffect(() => {
    if (reasoning !== 'inherit' && !reasoningOptions.some((option) => option.value === reasoning)) {
      dispatchForm({ type: 'field', field: 'reasoning', value: 'inherit' });
    }
  }, [reasoning, reasoningOptions]);

  useEffect(() => {
    if (!open) {
      initializedFormKeyRef.current = null;
      latestFormatRequestRef.current = null;
      return;
    }

    const fallbackProjectId = activeProjectId ?? projects[0]?.id ?? '';

    if (initializedFormKeyRef.current === currentFormKey) {
      if (!isEdit && fallbackProjectId) {
        dispatchForm({ type: 'ensure-project', projectId: fallbackProjectId });
      }
      return;
    }

    if (isEdit && existing) {
      const pid = presetForCron(existing.cronExpr);
      dispatchForm({
        type: 'load',
        form: {
          projectIds: existing.targets?.length ? existing.targets : [existing.projectId],
          name: existing.name,
          prompt: existing.prompt,
          presetId: pid,
          customCron: pid === 'custom' ? existing.cronExpr : '',
          enabled: existing.enabled,
          provider: existing.executorProvider ?? 'inherit',
          executorModelId: existing.executorModelId ?? '',
          reasoning: existing.executorReasoningEffort ?? 'inherit',
          error: null,
        },
      });
      initializedFormKeyRef.current = currentFormKey;
    } else if (!isEdit) {
      dispatchForm({
        type: 'load',
        form: {
          ...INITIAL_AUTOMATION_FORM_STATE,
          projectIds: fallbackProjectId ? [fallbackProjectId] : [],
        },
      });
      initializedFormKeyRef.current = currentFormKey;
    }
  }, [open, isEdit, currentFormKey, existing, activeProjectId, projects]);

  const cronExpr = useMemo(() => {
    if (presetId === 'custom') return customCron.trim();
    const found = PRESETS.find((p) => p.id === presetId);
    return found?.cron ?? '';
  }, [presetId, customCron]);

  const cronError = useMemo(() => validateCron(cronExpr), [cronExpr]);

  const createOrUpdate = useMutation({
    mutationFn: async () => {
      if (isEdit && editingId) {
        const patch: UpdateAutomationInput & { id: string } = {
          id: editingId,
          name: name.trim(),
          prompt: prompt.trim(),
          cronExpr,
          enabled,
          executorProvider: provider === 'inherit' ? null : provider,
          executorModelId: executorModelId.trim() || null,
          executorReasoningEffort: reasoning === 'inherit' ? null : reasoning,
        };
        return window.shipcode.invoke<Automation>('automations:update', patch);
      }
      const input: CreateAutomationInput = {
        projectId: projectIds[0],
        targets: projectIds,
        name: name.trim(),
        prompt: prompt.trim(),
        cronExpr,
        enabled,
        executorProvider: provider === 'inherit' ? null : provider,
        executorModelId: executorModelId.trim() || null,
        executorReasoningEffort: reasoning === 'inherit' ? null : reasoning,
      };
      return window.shipcode.invoke<Automation>('automations:create', input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      if (isEdit && editingId) {
        queryClient.invalidateQueries({ queryKey: ['automation', editingId] });
      }
      close();
    },
    onError: (err) => {
      log.error('[CreateAutomationModal] submit failed', err);
      dispatchForm({ type: 'field', field: 'error', value: clampError(err) });
    },
  });

  const formatAutomation = useMutation({
    mutationFn: async (variables: FormatAutomationVariables) => {
      return window.shipcode.invoke<{ prompt: string }>('ai:format-automation', {
        projectId: variables.projectId,
        prompt: variables.prompt,
        provider: variables.provider === 'inherit' ? null : variables.provider,
        modelId: variables.provider === 'inherit' ? null : variables.modelId.trim() || null,
        reasoningEffort: variables.reasoning === 'inherit' ? null : variables.reasoning,
      });
    },
    onSuccess: (result, variables) => {
      if (
        latestFormatRequestRef.current?.id !== variables.requestId ||
        latestFormatRequestRef.current.formKey !== variables.formKey ||
        initializedFormKeyRef.current !== variables.formKey
      ) {
        return;
      }
      dispatchForm({ type: 'field', field: 'prompt', value: result.prompt });
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
    onError: (err, variables) => {
      if (
        latestFormatRequestRef.current?.id !== variables.requestId ||
        latestFormatRequestRef.current.formKey !== variables.formKey
      ) {
        return;
      }
      log.error('[CreateAutomationModal] format failed', err);
      dispatchForm({ type: 'field', field: 'error', value: clampError(err) });
    },
    onSettled: (_result, _error, variables) => {
      if (
        variables &&
        latestFormatRequestRef.current?.id === variables.requestId &&
        latestFormatRequestRef.current.formKey === variables.formKey
      ) {
        latestFormatRequestRef.current = null;
      }
    },
  });

  const formatPendingForCurrentForm =
    formatAutomation.isPending && latestFormatRequestRef.current?.formKey === currentFormKey;
  const submitDisabled =
    createOrUpdate.isPending ||
    formatPendingForCurrentForm ||
    projectIds.length === 0 ||
    !name.trim() ||
    !prompt.trim() ||
    !!cronError;
  const formatDisabled =
    formatPendingForCurrentForm ||
    createOrUpdate.isPending ||
    projectIds.length === 0 ||
    !prompt.trim();

  const handleSubmit = () => {
    dispatchForm({ type: 'field', field: 'error', value: null });
    if (submitDisabled) return;
    createOrUpdate.mutate();
  };

  const handleFormat = () => {
    dispatchForm({ type: 'field', field: 'error', value: null });
    if (formatDisabled) return;
    nextFormatRequestIdRef.current += 1;
    const requestId = nextFormatRequestIdRef.current;
    latestFormatRequestRef.current = { id: requestId, formKey: currentFormKey };
    formatAutomation.mutate({
      requestId,
      formKey: currentFormKey,
      projectId: projectIds[0],
      prompt,
      provider,
      modelId: executorModelId,
      reasoning,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={isEdit ? 'Edit automation' : 'New automation'}
      className="max-w-[640px] max-h-[88vh] flex flex-col overflow-hidden p-0"
      headerClassName="shrink-0 border-b border-border px-6 py-4"
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auto-name" className="text-xs text-secondary">
            Name
          </Label>
          <Input
            id="auto-name"
            value={name}
            onChange={(e) => dispatchForm({ type: 'field', field: 'name', value: e.target.value })}
            placeholder="Daily smoke test"
          />
        </div>

        {!isEdit && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-secondary">Target repos</Label>
            <div className="flex flex-wrap gap-1.5">
              {projects.map((p) => {
                const selected = projectIds.includes(p.id);
                return (
                  <Button
                    key={p.id}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    size="xs"
                    aria-pressed={selected}
                    onClick={() =>
                      dispatchForm({
                        type: 'field',
                        field: 'projectIds',
                        value: selected
                          ? projectIds.filter((id) => id !== p.id)
                          : [...projectIds, p.id],
                      })
                    }
                  >
                    {p.name}
                  </Button>
                );
              })}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Runs once per selected repo, each in its own worktree.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="auto-prompt" className="text-xs text-secondary">
              Prompt
            </Label>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleFormat}
              disabled={formatDisabled}
              title="Format this automation prompt into a clear agent-ready spec"
            >
              <LoadingButtonContent
                loading={formatPendingForCurrentForm}
                className="gap-1"
                spinnerSize={10}
              >
                <Wand2 size={12} />
                Format
              </LoadingButtonContent>
            </Button>
          </div>
          <Textarea
            id="auto-prompt"
            value={prompt}
            onChange={(e) =>
              dispatchForm({ type: 'field', field: 'prompt', value: e.target.value })
            }
            placeholder="What should this run do?"
            rows={6}
            className="text-[13px]"
            disabled={formatPendingForCurrentForm}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auto-preset" className="text-xs text-secondary">
            Schedule
          </Label>
          <Select
            value={presetId}
            onValueChange={(value) => dispatchForm({ type: 'field', field: 'presetId', value })}
          >
            <SelectTrigger id="auto-preset" className="bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {presetId === 'custom' && (
            <Input
              value={customCron}
              onChange={(e) =>
                dispatchForm({ type: 'field', field: 'customCron', value: e.target.value })
              }
              placeholder="*/15 * * * *"
              className="font-mono text-xs"
            />
          )}
          {cronError ? (
            <div className="text-xs text-danger">{cronError}</div>
          ) : (
            <div className="text-[11px] text-muted-foreground">UTC. Standard 5-field cron.</div>
          )}
        </div>

        <CollapsibleSection
          title="Executor override (optional)"
          contentClassName="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-provider" className="text-xs text-secondary">
              Provider
            </Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                dispatchForm({
                  type: 'field',
                  field: 'provider',
                  value: value as 'inherit' | AgentType,
                })
              }
            >
              <SelectTrigger id="auto-provider" className="bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-model" className="text-xs text-secondary">
              Model ID
            </Label>
            <Input
              id="auto-model"
              value={executorModelId}
              onChange={(e) =>
                dispatchForm({
                  type: 'field',
                  field: 'executorModelId',
                  value: e.target.value,
                })
              }
              placeholder={executorModelPlaceholder(provider)}
              className="font-mono text-xs"
            />
            {executorModelSuggestions(provider).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {executorModelSuggestions(provider).map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      dispatchForm({
                        type: 'field',
                        field: 'executorModelId',
                        value: o.value,
                      })
                    }
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-reasoning" className="text-xs text-secondary">
              Reasoning effort
            </Label>
            <Select
              value={reasoning}
              onValueChange={(value) =>
                dispatchForm({
                  type: 'field',
                  field: 'reasoning',
                  value: value as 'inherit' | ReasoningEffort,
                })
              }
            >
              <SelectTrigger id="auto-reasoning" className="bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reasoningOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CollapsibleSection>

        <Label
          htmlFor="auto-enabled"
          className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-tertiary/30 px-3 py-2.5 text-[13px] text-secondary"
        >
          <span>Enabled</span>
          <Switch
            id="auto-enabled"
            checked={enabled}
            onCheckedChange={(value) => dispatchForm({ type: 'field', field: 'enabled', value })}
          />
        </Label>
      </div>

      <ModalFooter className="shrink-0 items-center border-t border-border px-6 py-4 mt-0">
        <Button variant="secondary" onClick={close} disabled={createOrUpdate.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitDisabled}>
          <LoadingButtonContent loading={createOrUpdate.isPending}>
            <span>{isEdit ? 'Save' : 'Create'}</span>
            <Keycap className="border-transparent bg-black/10 text-current shadow-none">⌘⏎</Keycap>
          </LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function CreateAutomationModal() {
  return useCreateAutomationModalView();
}
