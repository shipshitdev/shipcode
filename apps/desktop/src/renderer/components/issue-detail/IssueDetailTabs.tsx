import type {
  DiffRecord,
  FeatureQaResult,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  ReasoningEffort,
  ReviewFindingRecord,
  ReviewRecord,
  TaskGraphWithNodes,
  Thread,
} from '@shipcode/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shipshitdev/ui';
import { CommentsTab } from './CommentsTab';
import { ConsoleTab } from './ConsoleTab';
import { ConversationsTab } from './ConversationsTab';
import { DiffTab } from './DiffTab';
import { FindingsTab } from './FindingsTab';
import { IssueChatTab } from './IssueChatTab';
import { IssueHistoryTab } from './IssueHistoryTab';
import { PlanHistoryTab } from './PlanHistoryTab';
import { PrdTab } from './PrdTab';
import { RunsTab } from './RunsTab';
import type { IssueDetailTab, PhaseKey, PhaseSelection, PlanRunGroup } from './tab-types';

interface IssueDetailTabsProps {
  activeIssue: GitHubIssueCacheRecord;
  activeTab: IssueDetailTab;
  activeThreadId: string | null;
  approvedAwaitingExecution: boolean;
  checkpoints: PipelineCheckpoint[];
  currentPhaseSelections: Record<PhaseKey, PhaseSelection>;
  diffs: DiffRecord[];
  effectiveExpanded: string | null | undefined;
  executorEditable: boolean;
  hasPrFeedbackBlockers: boolean;
  integrationStatus?: IntegrationStatus;
  isRefreshingFromGithub: boolean;
  isSubmitting: boolean;
  isShowingAllPlanRuns: boolean;
  effectiveRequireApproval: boolean;
  effectiveRevisionCount: number;
  inheritedRequireApproval: boolean;
  inheritedRevisionCount: number;
  loadingPlanDetailIds: string[];
  normalizedIssueActivity: import('@shipcode/shared').ActivityEntry[];
  normalizedPlanHistory: PlanRecord[];
  reviewFindings: ReviewFindingRecord[];
  normalizedReviewsByPlanId: Record<string, ReviewRecord>;
  normalizedThreadPlanHistory: PlanRecord[];
  isPlanHistoryLoading: boolean;
  currentPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  inheritedPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  phaseEffortSelectValues: Record<PhaseKey, string>;
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  requireApprovalSelectValue: string;
  revisionCountSelectValue: string;
  planHistoryCollapsed: boolean;
  planRunCount: number;
  planRunGroups: PlanRunGroup[];
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  qaResults: FeatureQaResult[];
  runNumberByThreadId: Record<string, number>;
  taskGraph: TaskGraphWithNodes | null;
  thread: Thread | null | undefined;
  threadPhase: PipelinePhase | 'idle';
  githubIssueUrl: string | null;
  projectId: string;
  commentComposerRequestId?: number | null;
  onEditPrd: () => void;
  onActiveTabChange: (tab: IssueDetailTab) => void;
  onFullScreenPlan: (planId: string | null) => void;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
  onPhaseEffortChange: (phase: PhaseKey, effort: string) => void;
  onRequireApprovalChange: (value: string) => void;
  onRevisionCountChange: (value: string) => void;
  onPhaseOpenRouterSlugBlur: (phase: PhaseKey, rawValue: string) => void;
  onPlanExpandedChange: (planId: string | null | undefined) => void;
  onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
  onShowAllPlanRunsChange: (show: boolean) => void;
  onRefreshFromGithub: () => void;
  onRestoreCheckpoint: (checkpoint: PipelineCheckpoint) => void;
  onStabilizePr: () => void;
}

export function IssueDetailTabs(props: IssueDetailTabsProps) {
  const {
    activeIssue,
    activeTab,
    activeThreadId,
    approvedAwaitingExecution,
    diffs,
    effectiveExpanded,
    isRefreshingFromGithub,
    isShowingAllPlanRuns,
    loadingPlanDetailIds,
    normalizedIssueActivity,
    normalizedPlanHistory,
    reviewFindings,
    normalizedReviewsByPlanId,
    normalizedThreadPlanHistory,
    isPlanHistoryLoading,
    planHistoryCollapsed,
    planRunCount,
    planRunGroups,
    runNumberByThreadId,
    threadPhase,
    projectId,
    commentComposerRequestId,
    onEditPrd,
    onActiveTabChange,
    onFullScreenPlan,
    onPlanExpandedChange,
    onPlanHistoryCollapsedChange,
    onShowAllPlanRunsChange,
    onRefreshFromGithub,
  } = props;
  const orderedTabs: Array<{ value: IssueDetailTab; label: string }> = [
    { value: 'prd', label: 'Issue' },
    { value: 'console', label: 'Console' },
    ...(activeIssue.isQuickMode
      ? []
      : ([{ value: 'comments' as const, label: 'Comments' }] as const)),
    {
      value: 'history',
      label: `Plans${normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}`,
    },
    ...(activeThreadId
      ? [
          {
            value: 'findings' as const,
            label:
              reviewFindings.filter((finding) => finding.status === 'open').length > 0
                ? `Findings (${reviewFindings.filter((finding) => finding.status === 'open').length})`
                : 'Findings',
          },
        ]
      : []),
    ...(activeThreadId
      ? [{ value: 'diff' as const, label: diffs.length > 0 ? `Diff (${diffs.length})` : 'Diff' }]
      : []),
    ...(activeThreadId ? [{ value: 'runs' as const, label: 'Runs' }] : []),
    {
      value: 'activity',
      label: `Activity${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
    },
    ...(activeThreadId ? [{ value: 'conversations' as const, label: 'Conversations' }] : []),
    ...(activeThreadId ? [{ value: 'chat' as const, label: 'Chat' }] : []),
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as IssueDetailTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 overflow-x-auto mb-5">
        <TabsList className="w-full">
          {orderedTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-t-md data-[state=active]:bg-elevated data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0_hsl(var(--accent))]"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="prd" className={'mt-0'}>
        <PrdTab
          activeIssue={activeIssue}
          isRefreshingFromGithub={isRefreshingFromGithub}
          onEditPrd={onEditPrd}
          onRefreshFromGithub={onRefreshFromGithub}
        />
      </TabsContent>

      <TabsContent value="console" className="mt-0 overflow-hidden">
        <ConsoleTab
          activeThreadId={activeThreadId}
          approvedAwaitingExecution={approvedAwaitingExecution}
          threadPhase={threadPhase}
        />
      </TabsContent>

      <TabsContent value="comments" className={'mt-0'}>
        <CommentsTab
          projectId={projectId}
          issueNumber={activeIssue.issueNumber}
          focusComposerRequestId={commentComposerRequestId}
        />
      </TabsContent>

      <TabsContent value="history" className={'mt-0'}>
        <PlanHistoryTab
          activeThreadId={activeThreadId}
          effectiveExpanded={effectiveExpanded}
          isPlanHistoryLoading={isPlanHistoryLoading}
          isShowingAllPlanRuns={isShowingAllPlanRuns}
          loadingPlanDetailIds={loadingPlanDetailIds}
          normalizedPlanHistory={normalizedPlanHistory}
          normalizedReviewsByPlanId={normalizedReviewsByPlanId}
          normalizedThreadPlanHistory={normalizedThreadPlanHistory}
          planHistoryCollapsed={planHistoryCollapsed}
          planRunCount={planRunCount}
          planRunGroups={planRunGroups}
          threadPhase={threadPhase}
          onFullScreenPlan={onFullScreenPlan}
          onPlanExpandedChange={onPlanExpandedChange}
          onPlanHistoryCollapsedChange={onPlanHistoryCollapsedChange}
          onShowAllPlanRunsChange={onShowAllPlanRunsChange}
        />
      </TabsContent>

      {activeThreadId && (
        <TabsContent value="findings" className={'mt-0'}>
          <FindingsTab threadId={activeThreadId} findings={reviewFindings} />
        </TabsContent>
      )}

      <TabsContent value="diff" className={'mt-0'}>
        <DiffTab diffs={diffs} threadStatus={props.thread?.status} />
      </TabsContent>

      {activeThreadId && (
        <TabsContent value="runs" className={'mt-0'}>
          <RunsTab threadId={activeThreadId} />
        </TabsContent>
      )}

      <TabsContent value="activity" className={'mt-0'}>
        <IssueHistoryTab
          normalizedIssueActivity={normalizedIssueActivity}
          runNumberByThreadId={runNumberByThreadId}
        />
      </TabsContent>

      {activeThreadId && (
        <TabsContent value="conversations" className={'mt-0'}>
          <ConversationsTab threadId={activeThreadId} />
        </TabsContent>
      )}

      {activeThreadId && (
        <TabsContent value="chat" className="mt-0 overflow-hidden">
          <IssueChatTab
            threadId={activeThreadId}
            issueNumber={activeIssue.issueNumber}
            issueTitle={activeIssue.title}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
