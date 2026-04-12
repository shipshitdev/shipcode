import type { ReactNode } from 'react';
import {
  Archive,
  Bell,
  Button,
  ChevronLeft,
  cn,
  Folder,
  Keyboard,
  Settings,
  Workflow,
} from '@shipcode/ui';
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
    icon: <Bell size={14} />,
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    icon: <Workflow size={14} />,
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
