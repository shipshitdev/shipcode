export function isSyntheticResolvedModel(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === '<synthetic>';
}

export function sanitizeResolvedModel(value: string | null | undefined): string | null {
  if (!value) return null;
  return isSyntheticResolvedModel(value) ? null : value;
}
