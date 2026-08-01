import { COL_RESIZE_BODY_CLASS_NAMES, useDragResize } from '../../hooks/useDragResize';

export const DETAIL_SIDEBAR_MIN = 320;
export const DETAIL_SIDEBAR_MAX = 640;
const DETAIL_SIDEBAR_DEFAULT = 416; // matches previous w-[26rem]

export function useResizableDetailSidebar() {
  // Right-anchored panel: dragging its left edge leftwards widens it.
  const { size: detailSidebarWidth, handleResizeMouseDown: handleDetailResizeMouseDown } =
    useDragResize({
      initialSize: DETAIL_SIDEBAR_DEFAULT,
      axis: 'x',
      direction: -1,
      min: DETAIL_SIDEBAR_MIN,
      max: DETAIL_SIDEBAR_MAX,
      bodyClassNames: COL_RESIZE_BODY_CLASS_NAMES,
    });

  return { detailSidebarWidth, handleDetailResizeMouseDown };
}
