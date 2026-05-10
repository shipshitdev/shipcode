import type { DiffRecord } from '@shipcode/shared';
import { SideBySideDiffViewer } from '@shipcode/ui';
import { Button, Modal } from '@shipshitdev/ui';
import { FileCode2, Maximize2, X } from 'lucide-react';
import { useState } from 'react';

export function DiffTab({ diffs, threadStatus }: { diffs: DiffRecord[]; threadStatus?: string }) {
  const [isFullScreen, setIsFullScreen] = useState(false);

  if (diffs.length === 0) {
    const isTerminal = threadStatus === 'completed' || threadStatus === 'closed';
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/10">
          <FileCode2 size={20} className="text-muted-foreground/50" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {isTerminal ? 'No code changes' : 'No code changes yet'}
          </p>
          <p className="text-xs text-muted-foreground/50">
            {isTerminal
              ? 'Pipeline completed without producing code changes.'
              : 'Diff will appear here after execution produces changes.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
            Code Changes
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {diffs.length} file{diffs.length === 1 ? '' : 's'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsFullScreen(true)}
              title="Full screen diff"
              aria-label="Full screen diff"
            >
              <Maximize2 size={13} />
            </Button>
          </div>
        </div>

        <div
          className="overflow-hidden rounded-md border border-border"
          style={{ height: 'calc(100vh - 180px)' }}
        >
          <SideBySideDiffViewer diffs={diffs} className="h-full" />
        </div>
      </div>

      <Modal
        open={isFullScreen}
        onClose={() => setIsFullScreen(false)}
        title="Code Changes"
        className="max-w-[95vw] h-[90vh] flex flex-col overflow-hidden p-0"
        headerClassName="shrink-0 border-b border-border px-6 py-4"
        headerAction={
          <Button
            variant="ghost"
            className="size-7 p-0"
            onClick={() => setIsFullScreen(false)}
            aria-label="Close full screen diff"
          >
            <X size={15} strokeWidth={2.25} />
          </Button>
        }
      >
        <div className="flex-1 min-h-0">
          <SideBySideDiffViewer diffs={diffs} className="h-full" />
        </div>
      </Modal>
    </>
  );
}
