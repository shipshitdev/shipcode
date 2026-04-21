import {
  CLARIFICATION_FENCE_TAG,
  PLAN_FENCE_TAG,
  REVIEW_FENCE_TAG,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';

export type SuppressedFenceTag =
  | 'shipcode-plan'
  | 'shipcode-clarification'
  | 'shipcode-review'
  | 'shipcode-verification';

export const FENCE_ACTIONS: Record<
  SuppressedFenceTag,
  { label: string; action: 'open-issue-detail' }
> = {
  [PLAN_FENCE_TAG]: { label: 'Plan drafted', action: 'open-issue-detail' as const },
  [REVIEW_FENCE_TAG]: { label: 'AI review complete', action: 'open-issue-detail' as const },
  [VERIFICATION_FENCE_TAG]: {
    label: 'Verification complete',
    action: 'open-issue-detail' as const,
  },
  [CLARIFICATION_FENCE_TAG]: {
    label: 'Clarification requested',
    action: 'open-issue-detail' as const,
  },
} as const;

export const OPENING_FENCES = (Object.keys(FENCE_ACTIONS) as SuppressedFenceTag[]).map((tag) => ({
  marker: `\`\`\`${tag}`,
  tag,
}));

export function findOpeningFence(
  text: string,
): { index: number; length: number; tag: SuppressedFenceTag } | null {
  let match: { index: number; length: number; tag: SuppressedFenceTag } | null = null;

  for (const { marker, tag } of OPENING_FENCES) {
    const index = text.indexOf(marker);
    if (index !== -1 && (!match || index < match.index)) {
      match = { index, length: marker.length, tag };
    }
  }

  return match;
}

export function getDeferredFencePrefix(text: string): string {
  let longest = '';

  for (const { marker } of OPENING_FENCES) {
    const maxLength = Math.min(marker.length - 1, text.length);
    for (let length = maxLength; length > longest.length; length--) {
      const suffix = text.slice(-length);
      if (marker.startsWith(suffix)) {
        longest = suffix;
        break;
      }
    }
  }

  return longest;
}
