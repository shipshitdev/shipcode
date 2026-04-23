import type { AppSettings, GhAuthStatus, SystemHealth } from '@shipcode/shared';
import { Alert, AlertDescription, Button } from '@shipcode/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function HealthBanner() {
  const queryClient = useQueryClient();
  const systemHealth = useAppStore((state) => state.systemHealth);
  const setSystemHealth = useAppStore((state) => state.setSystemHealth);
  const [canRunAuthCheck, setCanRunAuthCheck] = useState(false);

  const { data } = useQuery<SystemHealth>({
    queryKey: ['health'],
    queryFn: () => window.shipcode.invoke('health:check'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  // Separate query for the gh project scope. Static-ish; only re-fetches
  // every 5 minutes. The health:check channel doesn't carry token-scope
  // info, so we hit onboarding:check-auth which does (via checkGhAuth).
  const { data: authData } = useQuery<SystemHealth & { ghAuth: GhAuthStatus }>({
    queryKey: ['onboarding-auth'],
    queryFn: () => window.shipcode.invoke('onboarding:check-auth'),
    enabled: canRunAuthCheck && !!data?.gh.available,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const resetOnboarding = useMutation({
    mutationFn: () =>
      window.shipcode.invoke('settings:set', { onboardingVersion: 0 } as Partial<AppSettings>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  useEffect(() => {
    if (data) setSystemHealth(data);
  }, [data, setSystemHealth]);

  useEffect(() => {
    const id = window.setTimeout(() => setCanRunAuthCheck(true), 2_000);
    return () => window.clearTimeout(id);
  }, []);

  if (!systemHealth) return null;

  const issues: string[] = [];
  if (!systemHealth.claude.available) issues.push('Claude CLI not found');
  if (!systemHealth.codex.available) issues.push('Codex CLI not found');
  if (!systemHealth.git.available) issues.push('Git not found');

  // Auth warnings (only for installed CLIs)
  if (systemHealth.claude.available && !systemHealth.claude.authenticated) {
    issues.push('Claude CLI not authenticated');
  }
  if (systemHealth.codex.available && !systemHealth.codex.authenticated) {
    issues.push('Codex CLI not authenticated');
  }

  // gh project scope — only warn if the auth check ran successfully
  // AND the scope is explicitly missing. `null` means we couldn't parse
  // the scope list (older gh versions); skip the warning in that case.
  if (authData?.ghAuth?.authenticated && authData.ghAuth.hasProjectScope === false) {
    issues.push('gh missing `project` scope (run: gh auth refresh -s project)');
  }

  if (issues.length === 0) return null;

  return (
    <Alert
      variant="warning"
      className="flex items-center gap-2 rounded-none border-x-0 border-t-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs"
    >
      <span className="text-base font-bold leading-none">!</span>
      <AlertDescription className="text-xs text-warning">
        {issues.join(' \u00b7 ')}.
      </AlertDescription>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto border border-warning text-warning text-[11px] hover:bg-warning/15"
        onClick={() => resetOnboarding.mutate()}
        disabled={resetOnboarding.isPending}
      >
        Re-run Setup
      </Button>
    </Alert>
  );
}
