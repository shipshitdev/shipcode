import type {
  DiffRecord,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  ReasoningEffort,
  ReviewRecord,
  Thread,
} from '@shipcode/shared';
import { cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipshitdev/ui';
import { CommentsTab } from './CommentsTab';
import { CostsTab } from './CostsTab';
import { DiffTab } from './DiffTab';
import { IssueHistoryTab } from './IssueHistoryTab';
import { PipelineTab } from './PipelineTab';
import { PlanHistoryTab } from './PlanHistoryTab';
import { PrdTab } from './PrdTab';
import type { IssueDetailTab, PhaseKey, PhaseSelection, PlanRunGroup } from './tab-types';

interface IssueDetailTabsProps {
  activeIssue: GitHubIssueCacheRecord;
  activeTab: IssueDetailTab;
  activeThreadId: string | null;
  checkpoints: PipelineCheckpoint[];
  currentPhaseSelections: Record<PhaseKey, PhaseSelection>;
  diffs: DiffRecord[];
  effectiveExpanded: string | null | undefined;
  effectivePhaseResolvedModels: Record<PhaseKey, string>;
  executorEditable: boolean;
  expanded: boolean;
  hasPrFeedbackBlockers: boolean;
  integrationStatus?: IntegrationStatus;
  isRefreshingFromGithub: boolean;
  isSubmitting: boolean;
  isShowingAllPlanRuns: boolean;
  linkedPrUrl: string | null;
  effectiveRequireApproval: boolean;
  effectiveRevisionCount: number;
  inheritedRequireApproval: boolean;
  inheritedRevisionCount: number;
  loadingPlanDetailIds: string[];
  normalizedIssueActivity: import('@shipcode/shared').ActivityEntry[];
  normalizedPlanHistory: PlanRecord[];
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
  runNumberByThreadId: Record<string, number>;
  thread: Thread | null | undefined;
  threadPhase: PipelinePhase | 'idle';
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

export function IssueDetailTabs({
  activeIssue,
  activeTab,
  activeThreadId,
  checkpoints,
  currentPhaseSelections,
  diffs,
  effectiveExpanded,
  effectivePhaseResolvedModels,
  executorEditable,
  expanded,
  hasPrFeedbackBlockers,
  integrationStatus,
  isRefreshingFromGithub,
  isSubmitting,
  isShowingAllPlanRuns,
  linkedPrUrl,
  effectiveRequireApproval,
  effectiveRevisionCount,
  inheritedRequireApproval,
  inheritedRevisionCount,
  loadingPlanDetailIds,
  normalizedIssueActivity,
  normalizedPlanHistory,
  normalizedReviewsByPlanId,
  normalizedThreadPlanHistory,
  isPlanHistoryLoading,
  currentPhaseReasoningEfforts,
  inheritedPhaseReasoningEfforts,
  phaseEffortSelectValues,
  phaseModelValidation,
  phaseSelectValues,
  requireApprovalSelectValue,
  revisionCountSelectValue,
  planHistoryCollapsed,
  planRunCount,
  planRunGroups,
  projectDefaultPhaseSelections,
  runNumberByThreadId,
  thread,
  threadPhase,
  projectId,
  commentComposerRequestId,
  onEditPrd,
  onActiveTabChange,
  onFullScreenPlan,
  onPhaseAgentChange,
  onPhaseEffortChange,
  onRequireApprovalChange,
  onRevisionCountChange,
  onPhaseOpenRouterSlugBlur,
  onPlanExpandedChange,
  onPlanHistoryCollapsedChange,
  onShowAllPlanRunsChange,
  onRefreshFromGithub,
  onRestoreCheckpoint,
  onStabilizePr,
}: IssueDetailTabsProps) {
  const orderedTabs: Array<{ value: IssueDetailTab; label: string }> = [
    { value: 'prd', label: 'Issue' },
    { value: 'comments', label: 'Comments' },
    {
      value: 'history',
      label: `Plans${normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}`,
    },
    { value: 'pipeline', label: 'Pipeline' },
    ...(diffs.length > 0 ? [{ value: 'diff' as const, label: `Diff (${diffs.length})` }] : []),
    {
      value: 'activity',
      label: `Activity${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
    },
    { value: 'costs', label: 'Costs' },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as IssueDetailTab)}
      className="flex min-h-0 flex-col"
    >
      <div className={cn('flex shrink-0 items-center overflow-x-auto', expanded ? 'mb-5' : '')}>
        <TabsList className={cn(expanded ? '' : 'px-4')}>
          {orderedTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="prd" className={cn('mt-0', !expanded && 'p-4')}>
        <PrdTab
          activeIssue={activeIssue}
          expanded={expanded}
          isRefreshingFromGithub={isRefreshingFromGithub}
          onEditPrd={onEditPrd}
          onRefreshFromGithub={onRefreshFromGithub}
        />
      </TabsContent>

      <TabsContent value="comments" className={cn('mt-0', !expanded && 'p-4')}>
        <CommentsTab
          projectId={projectId}
          issueNumber={activeIssue.issueNumber}
          focusComposerRequestId={commentComposerRequestId}
        />
      </TabsContent>

      <TabsContent value="history" className={cn('mt-0', !expanded && 'p-4')}>
        <PlanHistoryTab
          activeThreadId={activeThreadId}
          effectiveExpanded={effectiveExpanded}
          expanded={expanded}
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

      <TabsContent value="pipeline" className={cn('mt-0', !expanded && 'p-4')}>
        <PipelineTab
          activeIssue={activeIssue}
          activeThreadId={activeThreadId}
          checkpoints={checkpoints}
          currentPhaseReasoningEfforts={currentPhaseReasoningEfforts}
          currentPhaseSelections={currentPhaseSelections}
          diffs={diffs}
          effectivePhaseResolvedModels={effectivePhaseResolvedModels}
          effectiveRequireApproval={effectiveRequireApproval}
          executorEditable={executorEditable}
          hasPrFeedbackBlockers={hasPrFeedbackBlockers}
          inheritedPhaseReasoningEfforts={inheritedPhaseReasoningEfforts}
          inheritedRequireApproval={inheritedRequireApproval}
          inheritedRevisionCount={inheritedRevisionCount}
          integrationStatus={integrationStatus}
          isSubmitting={isSubmitting}
          linkedPrUrl={linkedPrUrl}
          effectiveRevisionCount={effectiveRevisionCount}
          phaseEffortSelectValues={phaseEffortSelectValues}
          phaseModelValidation={phaseModelValidation}
          phaseSelectValues={phaseSelectValues}
          requireApprovalSelectValue={requireApprovalSelectValue}
          revisionCountSelectValue={revisionCountSelectValue}
          projectDefaultPhaseSelections={projectDefaultPhaseSelections}
          thread={thread}
          onPhaseAgentChange={onPhaseAgentChange}
          onPhaseEffortChange={onPhaseEffortChange}
          onRequireApprovalChange={onRequireApprovalChange}
          onRevisionCountChange={onRevisionCountChange}
          onPhaseOpenRouterSlugBlur={onPhaseOpenRouterSlugBlur}
          onRestoreCheckpoint={onRestoreCheckpoint}
          onStabilizePr={onStabilizePr}
        />
      </TabsContent>

      <TabsContent value="diff" className={cn('mt-0', !expanded && 'p-4')}>
        <DiffTab diffs={diffs} expanded={expanded} />
      </TabsContent>

      <TabsContent value="activity" className={cn('mt-0', !expanded && 'p-4')}>
        <IssueHistoryTab
          normalizedIssueActivity={normalizedIssueActivity}
          runNumberByThreadId={runNumberByThreadId}
        />
      </TabsContent>

      <TabsContent value="costs" className={cn('mt-0', !expanded && 'p-4')}>
        <CostsTab projectId={projectId} issueNumber={activeIssue.issueNumber} thread={thread} />
      </TabsContent>
    </Tabs>
  );
}
