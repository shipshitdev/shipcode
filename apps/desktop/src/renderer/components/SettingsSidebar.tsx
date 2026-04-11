import type { ReactNode } from 'react';
import { Button, cn, ChevronLeft, Settings, Folder, Archive, Keyboard } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';
import type { SettingsSection } from '../stores/app-store';

const SECTIONS: { key: SettingsSection; label: string; icon: ReactNode }[] = [
  {
    key: 'general',
    label: 'General',
    icon: <Settings size={14} />,
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: <Folder size={14} />,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1.5A4.5 4.5 0 0 0 3.5 6v3.5L2 11h12l-1.5-1.5V6A4.5 4.5 0 0 0 8 1.5z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M6.5 11.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="2.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="3" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="13" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 4v3.5M8 7.5l-4 4M8 7.5l4 4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    key: 'shortcuts',
    label: 'Shortcuts',
    icon: <Keyboard size={14} />,
  },
  {
    key: 'archived',
    label: 'Archived',
    icon: <Archive size={14} />,
  },
];

export function SettingsSidebar() {
  const { settingsSection, setSettingsSection, toggleSettings } = useAppStore();

  return (
    <aside className="flex w-[256px] min-w-[256px] flex-col border-r border-border bg-primary">
      <div className="px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-1 text-[13px] font-normal text-secondary app-region-no-drag"
          onClick={toggleSettings}
        >
          <ChevronLeft size={14} />
          Back to app
        </Button>
      </div>

      <div className="mt-1 px-2">
        {SECTIONS.map(({ key, label, icon }) => (
          <Button
            variant="ghost"
            key={key}
            className={cn(
              'h-auto w-full justify-start gap-2 px-3 py-2 text-[13px] font-normal text-secondary app-region-no-drag',
              settingsSection === key && 'bg-tertiary text-primary',
            )}
            onClick={() => setSettingsSection(key)}
          >
            <span className="shrink-0 text-muted">{icon}</span>
            {label}
          </Button>
        ))}
      </div>
    </aside>
  );
}
