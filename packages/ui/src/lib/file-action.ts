type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent';

const ACTION_BADGE_VARIANTS = {
  create: 'success',
  delete: 'danger',
  modify: 'warning',
} as const satisfies Record<string, BadgeVariant>;

const ACTION_COLORS: Record<string, string> = {
  create: 'text-success',
  delete: 'text-danger',
  modify: 'text-warning',
};

const ACTION_ICONS: Record<string, string> = {
  create: '+',
  delete: '-',
  modify: '~',
};

export function diffActionVariant(action: string): BadgeVariant {
  return ACTION_BADGE_VARIANTS[action as keyof typeof ACTION_BADGE_VARIANTS] ?? 'default';
}

export function planFileActionVariant(action: string): BadgeVariant {
  return action === 'rename' ? 'accent' : diffActionVariant(action);
}

export function fileActionColor(action: string): string {
  return ACTION_COLORS[action] ?? 'text-secondary';
}

export function fileActionIcon(action: string): string {
  return ACTION_ICONS[action] ?? '~';
}

export function sideBySideFileActionColor(action: string): string {
  return action === 'rename' ? 'text-accent' : fileActionColor(action);
}

export function sideBySideFileActionIcon(action: string): string {
  return action === 'rename' ? '→' : fileActionIcon(action);
}
