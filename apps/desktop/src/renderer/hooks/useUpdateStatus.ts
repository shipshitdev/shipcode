import type { UpdateStatus } from '@shipcode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

const UPDATE_STATUS_QUERY_KEY = ['update-status'] as const;

export function useUpdateStatus(): UpdateStatus | undefined {
  const queryClient = useQueryClient();
  const { data: updateStatus } = useQuery<UpdateStatus>({
    queryKey: UPDATE_STATUS_QUERY_KEY,
    queryFn: () => window.shipcode.invoke('update:get-status'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!window.shipcode?.on) return;
    return window.shipcode.on('update:status-changed', (next: UpdateStatus) => {
      queryClient.setQueryData(UPDATE_STATUS_QUERY_KEY, next);
    });
  }, [queryClient]);

  return updateStatus;
}
