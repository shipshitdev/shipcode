import type { IssuePipelineStatus } from '@shipcode/shared';
import type { BoardColumn, BoardSortOrder, ColumnKey } from './types';

export const COLUMNS: BoardColumn[] = [
  {
    key: 'todo',
    label: 'Todo',
    droppable: true,
    statuses: ['todo'],
  },
  {
    key: 'agent',
    label: 'Agent Loop',
    statuses: [
      'queued',
      'planning',
      'reviewing',
      'revising',
      'executing',
      'testing',
      'verifying',
      'shipping',
    ],
    sections: [
      {
        key: 'queued',
        label: 'Queued',
        statuses: ['queued'],
        droppable: false,
      },
      {
        key: 'planning',
        label: 'Planning',
        statuses: ['planning'],
        droppable: true,
      },
      {
        key: 'reviewing',
        label: 'Reviewing',
        statuses: ['reviewing', 'revising'],
        droppable: false,
      },
      {
        key: 'executing',
        label: 'Executing',
        statuses: ['executing'],
        droppable: false,
      },
      {
        key: 'testing',
        label: 'Testing',
        statuses: ['testing'],
        droppable: false,
      },
      {
        key: 'verifying',
        label: 'Verifying',
        statuses: ['verifying', 'shipping'],
        droppable: false,
      },
    ],
  },
  {
    key: 'human',
    label: 'Human',
    statuses: ['clarifying', 'awaiting_approval', 'failed'],
    sections: [
      {
        key: 'clarifying',
        label: 'Clarifying',
        statuses: ['clarifying'],
        droppable: false,
      },
      {
        key: 'awaiting',
        label: 'Awaiting Approval',
        statuses: ['awaiting_approval'],
        droppable: false,
      },
      {
        key: 'failed',
        label: 'Failed',
        statuses: ['failed'],
        droppable: false,
      },
    ],
  },
  {
    key: 'done',
    label: 'Done',
    droppable: false,
    statuses: ['completed', 'done'],
    sections: [
      {
        key: 'completed',
        label: 'Completed',
        statuses: ['completed'],
        droppable: false,
      },
      {
        key: 'done',
        label: 'Done',
        statuses: ['done'],
        droppable: true,
      },
    ],
  },
];

export const COLUMN_DOT_CLASS: Record<ColumnKey, string> = {
  todo: 'bg-success',
  agent: 'bg-agent',
  human: 'bg-warning',
  done: 'bg-done',
};

export const DRAGGABLE_STATUSES: IssuePipelineStatus[] = [
  'todo',
  'queued',
  'completed',
  'failed',
  'awaiting_approval',
];

export const ACTIVE_STATUSES: IssuePipelineStatus[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

export const PHASE_ELAPSED_STATUSES: IssuePipelineStatus[] = [
  'planning',
  'clarifying',
  'reviewing',
  'revising',
  'awaiting_approval',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

export const LIST_COLUMN_LABEL: Record<ColumnKey, string> = {
  todo: 'Todo',
  agent: 'In Progress',
  human: 'Needs Attention',
  done: 'Done',
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
