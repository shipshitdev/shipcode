import type {
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
import {
  Button,
  cn,
  Pencil,
  RefreshCw,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shipcode/ui';
import { CommentsTab } from './CommentsTab';
import { CostsTab } from './CostsTab';
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
  effectiveExpanded: string | null | undefined;
  effectivePhaseResolvedModels: Record<PhaseKey, string>;
  executorEditable: boolean;
  expanded: boolean;
  hasPrFeedbackBlockers: boolean;
  integrationStatus?: IntegrationStatus;
  isRefreshingFromGithub: boolean;
  isSubmitting: boolean;
  linkedPrUrl: string | null;
  normalizedIssueActivity: import('@shipcode/shared').ActivityEntry[];
  normalizedPlanHistory: PlanRecord[];
  normalizedReviewsByPlanId: Record<string, ReviewRecord>;
  normalizedThreadPlanHistory: PlanRecord[];
  isPlanHistoryLoading: boolean;
  hasPlanHistory: boolean;
  currentPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  inheritedPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  phaseEffortSelectValues: Record<PhaseKey, string>;
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  planHistoryCollapsed: boolean;
  planRunCount: number;
  planRunGroups: PlanRunGroup[];
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  runNumberByThreadId: Record<string, number>;
  thread: Thread | null | undefined;
  threadPhase: PipelinePhase | 'idle';
  projectId: string;
  onEditPrd: () => void;
  onActiveTabChange: (tab: IssueDetailTab) => void;
  onFullScreenPlan: (planId: string | null) => void;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
  onPhaseEffortChange: (phase: PhaseKey, effort: string) => void;
  onPhaseOpenRouterSlugBlur: (phase: PhaseKey, rawValue: string) => void;
  onPlanExpandedChange: (planId: string | null | undefined) => void;
  onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
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
  effectiveExpanded,
  effectivePhaseResolvedModels,
  executorEditable,
  expanded,
  hasPrFeedbackBlockers,
  integrationStatus,
  isRefreshingFromGithub,
  isSubmitting,
  linkedPrUrl,
  normalizedIssueActivity,
  normalizedPlanHistory,
  normalizedReviewsByPlanId,
  normalizedThreadPlanHistory,
  isPlanHistoryLoading,
  hasPlanHistory,
  currentPhaseReasoningEfforts,
  inheritedPhaseReasoningEfforts,
  phaseEffortSelectValues,
  phaseModelValidation,
  phaseSelectValues,
  planHistoryCollapsed,
  planRunCount,
  planRunGroups,
  projectDefaultPhaseSelections,
  runNumberByThreadId,
  thread,
  threadPhase,
  projectId,
  onEditPrd,
  onActiveTabChange,
  onFullScreenPlan,
  onPhaseAgentChange,
  onPhaseEffortChange,
  onPhaseOpenRouterSlugBlur,
  onPlanExpandedChange,
  onPlanHistoryCollapsedChange,
  onRefreshFromGithub,
  onRestoreCheckpoint,
  onStabilizePr,
}: IssueDetailTabsProps) {
  const orderedTabs: Array<{ value: IssueDetailTab; label: string }> = hasPlanHistory
    ? [
        {
          value: 'history',
          label: `Plan History${normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}`,
        },
        { value: 'prd', label: 'Issue' },
        { value: 'comments', label: 'Comments' },
        { value: 'pipeline', label: 'Pipeline' },
        {
          value: 'activity',
          label: `Issue History${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
        },
        { value: 'costs', label: 'Costs' },
      ]
    : [
        { value: 'prd', label: 'Issue' },
        { value: 'comments', label: 'Comments' },
        {
          value: 'history',
          label: `Plan History${normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}`,
        },
        { value: 'pipeline', label: 'Pipeline' },
        {
          value: 'activity',
          label: `Issue History${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
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
        {activeTab === 'prd' && (
          <div className="ml-auto flex shrink-0 items-center gap-1 pr-4">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRefreshFromGithub}
              disabled={isRefreshingFromGithub}
              title="Re-fetch issue from GitHub"
              aria-label="Refresh issue from GitHub"
            >
              <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEditPrd}
              title="Edit issue body"
              aria-label="Edit issue body"
            >
              <Pencil size={13} />
            </Button>
          </div>
        )}
      </div>

      <TabsContent value="prd" className={cn('mt-0', !expanded && 'p-4')}>
        <PrdTab activeIssue={activeIssue} expanded={expanded} />
      </TabsContent>

      <TabsContent value="comments" className={cn('mt-0', !expanded && 'p-4')}>
        <CommentsTab projectId={projectId} issueNumber={activeIssue.issueNumber} />
      </TabsContent>

      <TabsContent value="history" className={cn('mt-0', !expanded && 'p-4')}>
        <PlanHistoryTab
          activeThreadId={activeThreadId}
          effectiveExpanded={effectiveExpanded}
          expanded={expanded}
          isPlanHistoryLoading={isPlanHistoryLoading}
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
        />
      </TabsContent>

      <TabsContent value="pipeline" className={cn('mt-0', !expanded && 'p-4')}>
        <PipelineTab
          activeIssue={activeIssue}
          activeThreadId={activeThreadId}
          checkpoints={checkpoints}
          currentPhaseReasoningEfforts={currentPhaseReasoningEfforts}
          currentPhaseSelections={currentPhaseSelections}
          effectivePhaseResolvedModels={effectivePhaseResolvedModels}
          executorEditable={executorEditable}
          hasPrFeedbackBlockers={hasPrFeedbackBlockers}
          inheritedPhaseReasoningEfforts={inheritedPhaseReasoningEfforts}
          integrationStatus={integrationStatus}
          isSubmitting={isSubmitting}
          linkedPrUrl={linkedPrUrl}
          phaseEffortSelectValues={phaseEffortSelectValues}
          phaseModelValidation={phaseModelValidation}
          phaseSelectValues={phaseSelectValues}
          projectDefaultPhaseSelections={projectDefaultPhaseSelections}
          thread={thread}
          onPhaseAgentChange={onPhaseAgentChange}
          onPhaseEffortChange={onPhaseEffortChange}
          onPhaseOpenRouterSlugBlur={onPhaseOpenRouterSlugBlur}
          onRestoreCheckpoint={onRestoreCheckpoint}
          onStabilizePr={onStabilizePr}
        />
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
