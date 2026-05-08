import { SettingsSection } from '@shipcode/ui';
import { SHORTCUTS, type ShortcutCategory, type ShortcutDef } from '../../data/shortcuts';

export function ShortcutsSection() {
  const byCategory = SHORTCUTS.reduce<Record<ShortcutCategory, ShortcutDef[]>>(
    (acc, shortcut) => {
      const items = acc[shortcut.category] ?? [];
      items.push(shortcut);
      acc[shortcut.category] = items;
      return acc;
    },
    {} as Record<ShortcutCategory, ShortcutDef[]>,
  );

  return (
    <>
      <h3 className="mb-1">Keyboard Shortcuts</h3>
      <p className="mb-6 text-xs text-muted">
        Reference of every shortcut in ShipCode. Custom key bindings are not supported yet.
      </p>
      {(Object.entries(byCategory) as [ShortcutCategory, ShortcutDef[]][]).map(
        ([category, items]) => (
          <SettingsSection key={category} title={category} className="mb-6">
            <div className="divide-y divide-border rounded-md border border-border bg-tertiary">
              {items.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-primary">{shortcut.label}</div>
                    <div className="text-[11px] text-muted">{shortcut.description}</div>
                  </div>
                  <kbd className="shrink-0 rounded border border-border bg-primary px-2 py-1 font-mono text-[12px] tracking-widest text-secondary">
                    {shortcut.glyph}
                  </kbd>
                </div>
              ))}
            </div>
          </SettingsSection>
        ),
      )}
    </>
  );
}
