import type { AppSettings } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';

interface UseAppSettingsOptions {
  enabled?: boolean;
}

export function useAppSettings({ enabled = true }: UseAppSettingsOptions = {}) {
  return useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
    enabled,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
}
