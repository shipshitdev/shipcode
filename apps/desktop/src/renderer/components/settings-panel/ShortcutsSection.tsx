import { SHORTCUTS, type ShortcutCategory, type ShortcutDef } from '../../data/shortcuts';

export function ShortcutsSection() {
  const byCategory = SHORTCUTS.reduce<Record<ShortcutCategory, ShortcutDef[]>>(
    (acc, shortcut) => {
      (acc[shortcut.category] ??= []).push(shortcut);
      return acc;
    },
    {} as Record<ShortcutCategory, ShortcutDef[]>,
  );

  return (
    <>
      <h3 className="mb-1">Keyboard Shortcuts</h3>
      <p className="mb-6 text-xs text-muted">
        Reference of every shortcut in ShipCode. Remapping isn&apos;t supported yet - if you want a
        different binding, edit{' '}
        <code className="rounded bg-tertiary px-1 py-0.5 text-[11px]">
          apps/desktop/src/renderer/data/shortcuts.ts
        </code>
        .
      </p>
      {(Object.entries(byCategory) as [ShortcutCategory, ShortcutDef[]][]).map(
        ([category, items]) => (
          <section key={category} className="mb-6">
            <h4 className="mb-2 text-xs uppercase tracking-wide text-muted">{category}</h4>
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
          </section>
        ),
      )}
    </>
  );
}
