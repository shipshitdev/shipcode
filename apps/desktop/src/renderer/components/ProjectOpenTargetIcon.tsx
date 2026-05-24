import type { ProjectOpenTarget } from '@shipcode/shared';
import { cn } from '@shipshitdev/ui';
import { Braces, FolderOpen, Ghost, Terminal } from 'lucide-react';

export function ProjectOpenTargetIcon({
  target,
  className,
}: {
  target: ProjectOpenTarget;
  className?: string;
}) {
  const iconClassName = cn('size-4 shrink-0 text-secondary', className);

  if (target === 'cursor') {
    return (
      <svg
        aria-hidden="true"
        className={iconClassName}
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path d="M12 2.25 21 7.2v9.6l-9 4.95-9-4.95V7.2l9-4.95Z" fill="#F4F4F5" />
        <path d="m12 2.25 9 4.95-9 4.95-9-4.95 9-4.95Z" fill="#D4D4D8" />
        <path d="M12 12.15 21 7.2v9.6l-9 4.95v-9.6Z" fill="#A1A1AA" />
        <path d="M12 12.15 3 7.2v9.6l9 4.95v-9.6Z" fill="#E4E4E7" />
        <path d="m12 2.25 9 4.95-9 4.95-9-4.95 9-4.95Z" stroke="#27272A" strokeWidth="1.2" />
        <path d="M3 7.2v9.6l9 4.95 9-4.95V7.2" stroke="#27272A" strokeWidth="1.2" />
        <path d="M12 12.15v9.6" stroke="#27272A" strokeWidth="1.2" />
      </svg>
    );
  }

  if (target === 'vscode') {
    return (
      <svg
        aria-hidden="true"
        className={iconClassName}
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M20.7 4.2 15.9 2 7.2 10.4 3.2 7.4 1.6 8.2v7.6l1.6.8 4-3 8.7 8.4 4.8-2.2V4.2Z"
          fill="#007ACC"
        />
        <path d="M15.9 7.45 9.35 12l6.55 4.55V7.45Z" fill="#1F9CF0" />
        <path d="M3.2 7.4 7.2 10.4 3.2 13.4V7.4Z" fill="#40B6FF" />
        <path d="M3.2 10.6 7.2 12 3.2 13.4v-2.8Z" fill="#007ACC" opacity=".75" />
      </svg>
    );
  }

  if (target === 'finder') return <FolderOpen size={14} className={iconClassName} />;
  if (target === 'terminal') return <Terminal size={14} className={iconClassName} />;
  if (target === 'ghostty') return <Ghost size={14} className={iconClassName} />;
  return <Braces size={14} className={iconClassName} />;
}
