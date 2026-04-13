import type {
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  ReviewRecord,
  Thread,
} from '@shipcode/shared';
import { cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@shipcode/ui';
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
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  planHistoryCollapsed: boolean;
  planRunCount: number;
  planRunGroups: PlanRunGroup[];
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  runNumberByThreadId: Record<string, number>;
  thread: Thread | null | undefined;
  threadPhase: PipelinePhase | 'idle';
  onEditPrd: () => void;
  onActiveTabChange: (tab: IssueDetailTab) => void;
  onFullScreenPlan: (planId: string | null) => void;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
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
  phaseModelValidation,
  phaseSelectValues,
  planHistoryCollapsed,
  planRunCount,
  planRunGroups,
  projectDefaultPhaseSelections,
  runNumberByThreadId,
  thread,
  threadPhase,
  onEditPrd,
  onActiveTabChange,
  onFullScreenPlan,
  onPhaseAgentChange,
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
        { value: 'prd', label: 'PRD' },
        { value: 'pipeline', label: 'Pipeline' },
        {
          value: 'activity',
          label: `Issue History${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
        },
      ]
    : [
        { value: 'prd', label: 'PRD' },
        {
          value: 'history',
          label: `Plan History${normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}`,
        },
        { value: 'pipeline', label: 'Pipeline' },
        {
          value: 'activity',
          label: `Issue History${normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}`,
        },
      ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onActiveTabChange(value as IssueDetailTab)}
      className="flex min-h-0 flex-col"
    >
      <TabsList className={cn('shrink-0', expanded ? 'mb-5' : 'px-4')}>
        {orderedTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="prd" className={cn('mt-0', !expanded && 'p-4')}>
        <PrdTab
          activeIssue={activeIssue}
          expanded={expanded}
          isRefreshingFromGithub={isRefreshingFromGithub}
          onEditPrd={onEditPrd}
          onRefreshFromGithub={onRefreshFromGithub}
        />
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
          currentPhaseSelections={currentPhaseSelections}
          effectivePhaseResolvedModels={effectivePhaseResolvedModels}
          executorEditable={executorEditable}
          hasPrFeedbackBlockers={hasPrFeedbackBlockers}
          integrationStatus={integrationStatus}
          isSubmitting={isSubmitting}
          linkedPrUrl={linkedPrUrl}
          phaseModelValidation={phaseModelValidation}
          phaseSelectValues={phaseSelectValues}
          projectDefaultPhaseSelections={projectDefaultPhaseSelections}
          thread={thread}
          onPhaseAgentChange={onPhaseAgentChange}
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
    </Tabs>
  );
}
