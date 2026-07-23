import type { RelativeTimeOptions } from '@shipcode/shared';

export const AUTOMATION_RELATIVE_TIME_OPTIONS = {
  mode: 'bidirectional',
  granularity: 'minutes',
  justNowThresholdSec: 60,
} as const satisfies RelativeTimeOptions;
