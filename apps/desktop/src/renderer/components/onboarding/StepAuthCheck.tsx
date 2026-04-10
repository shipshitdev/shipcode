import { useMutation } from '@tanstack/react-query';
import type { CliHealth, GhAuthStatus, SystemHealth } from '@shipcode/shared';
import { Badge, Button } from '@shipcode/ui';

interface AuthResult extends SystemHealth {
  ghAuth: GhAuthStatus;
}

interface Props {
  authResult: AuthResult | null;
  onRecheck: () => void;
  isChecking: boolean;
}

function CliStatus({ label, health }: { label: string; health: CliHealth }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-tertiary px-3 py-2">
      <span className="min-w-[100px] font-medium">{label}</span>
      <span>
        {!health.available ? (
          <Badge variant="danger">Not installed</Badge>
        ) : health.authenticated ? (
          <Badge variant="success">Authenticated</Badge>
        ) : (
          <Badge variant="warning">Not authenticated</Badge>
        )}
      </span>
      {health.version && (
        <span className="ml-auto text-[11px] font-mono text-muted">{health.version}</span>
      )}
    </div>
  );
}

export function StepAuthCheck({ authResult, onRecheck, isChecking }: Props) {
  const claudeAuth = authResult?.claude;
  const codexAuth = authResult?.codex;
  const ghAuth = authResult?.ghAuth;

  const aiAuthCount = [claudeAuth?.authenticated, codexAuth?.authenticated].filter(Boolean).length;

  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-2">Connect your AI agents</h3>
      <p className="text-secondary text-[13px] mb-4 leading-relaxed">
        ShipCode uses CLI tools to orchestrate AI coding agents. Authenticate at least one AI CLI to
        proceed.
      </p>

      {authResult ? (
        <div className="flex flex-col gap-2 mb-4">
          <CliStatus label="Claude CLI" health={authResult.claude} />
          <CliStatus label="Codex CLI" health={authResult.codex} />
          <div className="flex items-center gap-3 rounded-md bg-tertiary px-3 py-2">
            <span className="min-w-[100px] font-medium">GitHub CLI</span>
            <span>
              {!ghAuth?.installed ? (
                <Badge variant="danger">Not installed</Badge>
              ) : ghAuth?.authenticated ? (
                <Badge variant="success">
                  {ghAuth.username ? `@${ghAuth.username}` : 'Authenticated'}
                </Badge>
              ) : (
                <Badge variant="warning">Not authenticated</Badge>
              )}
            </span>
            {ghAuth?.version && (
              <span className="ml-auto text-[11px] font-mono text-muted">gh {ghAuth.version}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-muted">Checking CLI status...</div>
      )}

      {authResult && aiAuthCount === 1 && (
        <div className="rounded-md border border-[#3d2e00] bg-[#1c1c00] px-3 py-2.5 text-xs text-warning mb-4">
          Adversarial review requires both Claude and Codex. You can proceed in single-agent mode,
          but plan review will be skipped.
        </div>
      )}

      {authResult && aiAuthCount === 0 && (
        <div className="mb-4">
          <p className="text-secondary text-[13px] mb-2">Run these commands to authenticate:</p>
          <code className="block rounded-md bg-tertiary px-3 py-1.5 font-mono text-xs mb-1">
            claude login
          </code>
          <code className="block rounded-md bg-tertiary px-3 py-1.5 font-mono text-xs mb-1">
            codex login
          </code>
          <code className="block rounded-md bg-tertiary px-3 py-1.5 font-mono text-xs">
            gh auth login
          </code>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <Button variant="secondary" onClick={onRecheck} disabled={isChecking}>
          {isChecking ? 'Checking...' : 'Re-check'}
        </Button>
      </div>
    </div>
  );
}

export function useAuthCheck() {
  return useMutation({
    mutationFn: () => window.shipcode.invoke<AuthResult>('onboarding:check-auth'),
  });
}
