import type { IntegrationStatus } from '@shipcode/shared';
import { Button } from '@shipcode/ui';
import { StatusPill } from './StatusPill';

export function IntegrationsSettingsSection({
  integrationStatus,
  integrationsFetching,
  onRefetch,
}: {
  integrationStatus: IntegrationStatus | undefined;
  integrationsFetching: boolean;
  onRefetch: () => void;
}) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h3>Integrations</h3>
          <p className="mt-1 text-xs text-secondary">
            CLI and provider readiness. API keys remain env-managed for now.
          </p>
        </div>
        <Button variant="secondary" onClick={onRefetch} disabled={integrationsFetching}>
          {integrationsFetching ? 'Checking...' : 'Re-check'}
        </Button>
      </div>

      {!integrationStatus ? (
        <div className="text-[13px] text-muted">Loading integration status...</div>
      ) : (
        <>
          <section className="mb-8">
            <h4 className="mb-3 text-secondary">CLI Integrations</h4>
            <div className="space-y-2">
              {[
                { key: 'claude', label: 'Claude CLI' },
                { key: 'codex', label: 'Codex CLI' },
                { key: 'gh', label: 'GitHub CLI' },
              ].map(({ key, label }) => {
                const cli =
                  key === 'claude'
                    ? integrationStatus.system.claude
                    : key === 'codex'
                      ? integrationStatus.system.codex
                      : integrationStatus.system.gh;
                const ghScope =
                  key === 'gh'
                    ? integrationStatus.ghAuth.hasProjectScope === true
                      ? 'project scope granted'
                      : integrationStatus.ghAuth.hasProjectScope === false
                        ? 'project scope missing'
                        : null
                    : null;

                return (
                  <div key={key} className="rounded-md border border-border bg-secondary/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[110px] text-[13px] font-medium text-primary">
                        {label}
                      </div>
                      {!cli.available ? (
                        <StatusPill tone="danger">Not installed</StatusPill>
                      ) : key === 'gh' ? (
                        integrationStatus.ghAuth.authenticated ? (
                          <StatusPill tone="success">Authenticated</StatusPill>
                        ) : (
                          <StatusPill tone="warning">Not authenticated</StatusPill>
                        )
                      ) : cli.authenticated ? (
                        <StatusPill tone="success">Authenticated</StatusPill>
                      ) : (
                        <StatusPill tone="warning">Not authenticated</StatusPill>
                      )}
                      {ghScope ? (
                        <StatusPill
                          tone={integrationStatus.ghAuth.hasProjectScope ? 'success' : 'warning'}
                        >
                          {ghScope}
                        </StatusPill>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-1 text-[12px] text-secondary">
                      {cli.version ? (
                        <div>
                          Version: <code>{cli.version}</code>
                        </div>
                      ) : null}
                      {cli.path ? (
                        <div>
                          Path: <code>{cli.path}</code>
                        </div>
                      ) : null}
                      {key === 'gh' && integrationStatus.ghAuth.username ? (
                        <div>
                          Account: <code>@{integrationStatus.ghAuth.username}</code>
                        </div>
                      ) : null}
                      {cli.error ? <div className="text-red-300">{cli.error}</div> : null}
                      {key === 'gh' && integrationStatus.ghAuth.hasProjectScope === false ? (
                        <div className="text-amber-300">
                          Run <code>gh auth refresh -s project</code> to attach issues to project
                          boards.
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mb-8">
            <h4 className="mb-3 text-secondary">API Keys</h4>
            <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px] text-secondary">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-primary">OpenRouter</span>
                <StatusPill tone={integrationStatus.openrouter.enabled ? 'neutral' : 'warning'}>
                  {integrationStatus.openrouter.enabled
                    ? 'Enabled in settings'
                    : 'Disabled in settings'}
                </StatusPill>
                <StatusPill tone={integrationStatus.openrouter.keyPresent ? 'success' : 'warning'}>
                  {integrationStatus.openrouter.keyPresent
                    ? 'OPENROUTER_API_KEY detected'
                    : 'OPENROUTER_API_KEY missing'}
                </StatusPill>
                <StatusPill
                  tone={
                    integrationStatus.openrouter.authStatus === 'valid'
                      ? 'success'
                      : integrationStatus.openrouter.authStatus === 'disabled'
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {integrationStatus.openrouter.authStatus}
                </StatusPill>
              </div>
              <div className="space-y-1">
                <div>
                  ShipCode currently reads <code>OPENROUTER_API_KEY</code> from the environment
                  exposed to the desktop app.
                </div>
                {integrationStatus.openrouter.label ? (
                  <div>
                    Key label: <code>{integrationStatus.openrouter.label}</code>
                  </div>
                ) : null}
                {integrationStatus.openrouter.message ? (
                  <div className="text-amber-300">{integrationStatus.openrouter.message}</div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h4 className="mb-3 text-secondary">OpenRouter Models</h4>
            <div className="space-y-2">
              {integrationStatus.openrouter.modelChecks.map((check) => (
                <div
                  key={check.key}
                  className="rounded-md border border-border bg-secondary/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[140px] text-[13px] font-medium text-primary">
                      {check.label}
                    </div>
                    <StatusPill
                      tone={
                        check.status === 'valid'
                          ? 'success'
                          : check.status === 'invalid'
                            ? 'danger'
                            : check.status === 'unverified'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {check.status}
                    </StatusPill>
                  </div>
                  <div className="mt-2 space-y-1 text-[12px] text-secondary">
                    <div>
                      Model: <code>{check.modelId ?? '(not configured)'}</code>
                    </div>
                    {check.message ? <div className="text-amber-300">{check.message}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
