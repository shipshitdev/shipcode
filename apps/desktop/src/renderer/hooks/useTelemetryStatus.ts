import type { TelemetryStatus } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';

export function useTelemetryStatus() {
  return useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: () => window.shipcode.invoke<TelemetryStatus>('telemetry:get-status'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
}
