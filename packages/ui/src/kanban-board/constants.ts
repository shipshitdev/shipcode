import { ISSUE_PIPELINE_STATUS, type IssuePipelineStatus } from '@/lib/shipcode';
import type { BoardColumn, BoardSortOrder, ColumnKey } from './types';

export const COLUMNS: BoardColumn[] = [
  {
    key: 'todo',
    label: 'Todo',
    droppable: true,
    statuses: [ISSUE_PIPELINE_STATUS.todo],
  },
  {
    key: 'agent',
    label: 'Agent Loop',
    statuses: [
      ISSUE_PIPELINE_STATUS.queued,
      ISSUE_PIPELINE_STATUS.planning,
      ISSUE_PIPELINE_STATUS.reviewing,
      ISSUE_PIPELINE_STATUS.revising,
      ISSUE_PIPELINE_STATUS.executing,
      ISSUE_PIPELINE_STATUS.testing,
      ISSUE_PIPELINE_STATUS.verifying,
      ISSUE_PIPELINE_STATUS.shipping,
    ],
    sections: [
      {
        key: 'queued',
        label: 'Queued',
        statuses: [ISSUE_PIPELINE_STATUS.queued],
        droppable: false,
      },
      {
        key: 'planning',
        label: 'Planning',
        statuses: [ISSUE_PIPELINE_STATUS.planning],
        droppable: true,
      },
      {
        key: 'reviewing',
        label: 'Reviewing',
        statuses: [ISSUE_PIPELINE_STATUS.reviewing, ISSUE_PIPELINE_STATUS.revising],
        droppable: false,
      },
      {
        key: 'waiting_execution',
        label: 'Waiting For Execution',
        statuses: [ISSUE_PIPELINE_STATUS.awaitingApproval],
        droppable: false,
      },
      {
        key: 'executing',
        label: 'Executing',
        statuses: [ISSUE_PIPELINE_STATUS.executing],
        droppable: false,
      },
      {
        key: 'testing',
        label: 'Testing',
        statuses: [ISSUE_PIPELINE_STATUS.testing],
        droppable: false,
      },
      {
        key: 'verifying',
        label: 'Verifying',
        statuses: [ISSUE_PIPELINE_STATUS.verifying, ISSUE_PIPELINE_STATUS.shipping],
        droppable: false,
      },
    ],
  },
  {
    key: 'human',
    label: 'Human',
    statuses: [
      ISSUE_PIPELINE_STATUS.clarifying,
      ISSUE_PIPELINE_STATUS.awaitingApproval,
      ISSUE_PIPELINE_STATUS.failed,
    ],
    sections: [
      {
        key: 'clarifying',
        label: 'Clarifying',
        statuses: [ISSUE_PIPELINE_STATUS.clarifying],
        droppable: false,
      },
      {
        key: 'awaiting',
        label: 'Needs Approval',
        statuses: [ISSUE_PIPELINE_STATUS.awaitingApproval],
        droppable: false,
      },
      {
        key: 'failed',
        label: 'Failed',
        statuses: [ISSUE_PIPELINE_STATUS.failed],
        droppable: false,
      },
    ],
  },
  {
    key: 'done',
    label: 'Done',
    droppable: false,
    statuses: [ISSUE_PIPELINE_STATUS.completed, ISSUE_PIPELINE_STATUS.done],
    sections: [
      {
        key: 'completed',
        label: 'Completed',
        statuses: [ISSUE_PIPELINE_STATUS.completed],
        droppable: false,
      },
      {
        key: 'done',
        label: 'Done',
        statuses: [ISSUE_PIPELINE_STATUS.done],
        droppable: true,
      },
    ],
  },
  {
    key: 'deferred',
    label: 'Deferred',
    droppable: false,
    statuses: [ISSUE_PIPELINE_STATUS.deferred],
  },
];

export const COLUMN_DOT_CLASS: Record<ColumnKey, string> = {
  todo: 'bg-success',
  agent: 'bg-agent',
  human: 'bg-warning',
  done: 'bg-done',
  deferred: 'bg-text-muted',
};

/** Maps GitHub ProjectV2SingleSelectFieldOption color enum → CSS hex. */
export const GH_OPTION_COLOR_HEX: Record<string, string> = {
  GRAY: '#6e7681',
  BLUE: '#388bfd',
  GREEN: '#3fb950',
  YELLOW: '#d29922',
  ORANGE: '#db6d28',
  RED: '#f85149',
  PINK: '#db61a2',
  PURPLE: '#a371f7',
};

export const DRAGGABLE_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.todo,
  ISSUE_PIPELINE_STATUS.queued,
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.failed,
  ISSUE_PIPELINE_STATUS.awaitingApproval,
];

export const ACTIVE_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
];

export const PHASE_ELAPSED_STATUSES: IssuePipelineStatus[] = [
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.clarifying,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.awaitingApproval,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
];

export const LIST_COLUMN_LABEL: Record<ColumnKey, string> = {
  todo: 'Todo',
  agent: 'In Progress',
  human: 'Needs Attention',
  done: 'Done',
  deferred: 'Deferred',
};

export const LIST_COLUMN_DROP_ID: Partial<Record<ColumnKey, string>> = {
  todo: 'todo',
  agent: 'agent:planning',
  done: 'done:done',
};

export const BOARD_SORT_LABELS: Record<BoardSortOrder, string> = {
  priority: 'Priority',
  'id-desc': 'Newest ID',
  'id-asc': 'Oldest ID',
  title: 'Title',
};
