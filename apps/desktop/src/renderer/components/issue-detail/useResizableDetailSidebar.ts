import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from 'react';

export const DETAIL_SIDEBAR_MIN = 320;
export const DETAIL_SIDEBAR_MAX = 640;
const DETAIL_SIDEBAR_DEFAULT = 416; // matches previous w-[26rem]

export function useResizableDetailSidebar() {
  const [detailSidebarWidth, setDetailSidebarWidth] = useState(DETAIL_SIDEBAR_DEFAULT);
  const detailDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleDetailResizeMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      detailDragRef.current = { startX: e.clientX, startW: detailSidebarWidth };

      const onMove = (ev: MouseEvent) => {
        const drag = detailDragRef.current;
        if (!drag) return;
        const delta = drag.startX - ev.clientX;
        const next = Math.min(
          DETAIL_SIDEBAR_MAX,
          Math.max(DETAIL_SIDEBAR_MIN, drag.startW + delta),
        );
        setDetailSidebarWidth(next);
      };

      const onUp = () => {
        detailDragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('cursor-col-resize', 'select-none');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.classList.add('cursor-col-resize', 'select-none');
    },
    [detailSidebarWidth],
  );

  return { detailSidebarWidth, handleDetailResizeMouseDown };
}
