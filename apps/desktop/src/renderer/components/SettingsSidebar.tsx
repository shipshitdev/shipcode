import {
  Archive,
  Bell,
  FolderGit,
  Globe,
  Keyboard,
  Settings,
  Workflow,
  Wrench,
} from '@shipshitdev/ui';
import type { ReactNode } from 'react';
import type { SettingsSection } from '../stores/app-store';
import { useAppStore } from '../stores/app-store';
import { SettingsNavigation } from './SettingsNavigation';

const SECTIONS: { key: SettingsSection; label: string; icon: ReactNode }[] = [
  {
    key: 'general',
    label: 'General',
    icon: <Settings size={14} />,
  },
  {
    key: 'integrations',
    label: 'Integrations',
    icon: <Globe size={14} />,
  },
  {
    key: 'github',
    label: 'GitHub',
    icon: <FolderGit size={14} />,
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
  {
    key: 'developer',
    label: 'Developer',
    icon: <Wrench size={14} />,
  },
];

export function SettingsSidebar() {
  const settingsSection = useAppStore((state) => state.settingsSection);
  const setSettingsSection = useAppStore((state) => state.setSettingsSection);
  const toggleSettings = useAppStore((state) => state.toggleSettings);

  return (
    <SettingsNavigation
      items={SECTIONS}
      activeKey={settingsSection}
      onSelect={setSettingsSection}
      backLabel="Back to app"
      onBack={toggleSettings}
    />
  );
}
