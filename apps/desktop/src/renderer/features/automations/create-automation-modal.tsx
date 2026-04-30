import {
  type AgentType,
  type Automation,
  type CreateAutomationInput,
  clampError,
  type Project,
  type ReasoningEffort,
  type UpdateAutomationInput,
} from '@shipcode/shared';
import {
  Button,
  Input,
  Keycap,
  Label,
  LoadingButtonContent,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cron } from 'croner';
import log from 'electron-log/renderer';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/app-store';

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

const REASONING_OPTIONS: Array<{ value: 'inherit' | ReasoningEffort; label: string }> = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
];

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

export function CreateAutomationModal() {
  const queryClient = useQueryClient();
  const open = useAppStore((s) => s.createAutomationModalOpen);
  const editingId = useAppStore((s) => s.editingAutomationId);
  const close = useAppStore((s) => s.closeCreateAutomationModal);
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const isEdit = editingId !== null;

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects-visible'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list-visible'),
    enabled: open,
  });

  const { data: existing } = useQuery<Automation | null>({
    queryKey: ['automation', editingId],
    queryFn: () => window.shipcode.invoke<Automation | null>('automations:get', { id: editingId! }),
    enabled: open && isEdit,
  });

  const [projectId, setProjectId] = useState<string>('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [presetId, setPresetId] = useState<string>('hourly');
  const [customCron, setCustomCron] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState<'inherit' | AgentType>('inherit');
  const [executorModelId, setExecutorModelId] = useState('');
  const [reasoning, setReasoning] = useState<'inherit' | ReasoningEffort>('inherit');
  const [error, setError] = useState<string | null>(null);

  // Reset form when opening
  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setProjectId(existing.projectId);
      setName(existing.name);
      setPrompt(existing.prompt);
      const pid = presetForCron(existing.cronExpr);
      setPresetId(pid);
      setCustomCron(pid === 'custom' ? existing.cronExpr : '');
      setEnabled(existing.enabled);
      setProvider(existing.executorProvider ?? 'inherit');
      setExecutorModelId(existing.executorModelId ?? '');
      setReasoning(existing.executorReasoningEffort ?? 'inherit');
    } else if (!isEdit) {
      setProjectId(activeProjectId ?? projects[0]?.id ?? '');
      setName('');
      setPrompt('');
      setPresetId('hourly');
      setCustomCron('');
      setEnabled(true);
      setProvider('inherit');
      setExecutorModelId('');
      setReasoning('inherit');
    }
    setError(null);
  }, [open, isEdit, existing, activeProjectId, projects]);

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
        projectId,
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
      setError(clampError(err));
    },
  });

  const submitDisabled =
    createOrUpdate.isPending || !projectId || !name.trim() || !prompt.trim() || !!cronError;

  const handleSubmit = () => {
    setError(null);
    if (submitDisabled) return;
    createOrUpdate.mutate();
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
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily smoke test"
            autoFocus
          />
        </div>

        {!isEdit && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-project" className="text-xs text-secondary">
              Project
            </Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="auto-project" className="bg-transparent">
                <SelectValue placeholder="Select a project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auto-prompt" className="text-xs text-secondary">
            Prompt
          </Label>
          <Textarea
            id="auto-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should this run do?"
            rows={6}
            className="text-[13px]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auto-preset" className="text-xs text-secondary">
            Schedule
          </Label>
          <Select value={presetId} onValueChange={setPresetId}>
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
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="*/15 * * * *"
              className="font-mono text-xs"
            />
          )}
          {cronError ? (
            <div className="text-xs text-danger">{cronError}</div>
          ) : (
            <div className="text-[11px] text-muted">UTC. Standard 5-field cron.</div>
          )}
        </div>

        <details className="rounded-md border border-border bg-tertiary/20 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-secondary">
            Executor override (optional)
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auto-provider" className="text-xs text-secondary">
                Provider
              </Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as 'inherit' | AgentType)}
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
                onChange={(e) => setExecutorModelId(e.target.value)}
                placeholder="e.g. anthropic/claude-opus-4-7"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auto-reasoning" className="text-xs text-secondary">
                Reasoning effort
              </Label>
              <Select
                value={reasoning}
                onValueChange={(v) => setReasoning(v as 'inherit' | ReasoningEffort)}
              >
                <SelectTrigger id="auto-reasoning" className="bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </details>

        <Label
          htmlFor="auto-enabled"
          className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-tertiary/30 px-3 py-2.5 text-[13px] text-secondary"
        >
          <span>Enabled</span>
          <Switch id="auto-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </Label>
      </div>

      <ModalFooter className="shrink-0 items-center border-t border-border px-6 py-4 mt-0">
        <Button variant="secondary" onClick={close} disabled={createOrUpdate.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitDisabled}>
          <LoadingButtonContent loading={createOrUpdate.isPending}>
            <span>{isEdit ? 'Save' : 'Create'}</span>
            <Keycap>⌘↩</Keycap>
          </LoadingButtonContent>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
