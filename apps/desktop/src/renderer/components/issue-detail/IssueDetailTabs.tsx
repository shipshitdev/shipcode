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
import { CollapsibleSection } from '@shipcode/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { CommentsTab } from './CommentsTab';
import { ConsoleTab } from './ConsoleTab';
import { ConversationsTab } from './ConversationsTab';
import { DiffTab } from './DiffTab';
import { FindingsTab } from './FindingsTab';
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

function ContextCard({
  value,
  title,
  count,
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  value: IssueDetailTab;
  title: string;
  count?: ReactNode;
  open: boolean;
  defaultOpen?: boolean;
  onOpenChange: (value: IssueDetailTab, open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={`issue-context-${value}`}>
      <CollapsibleSection
        title={title}
        count={count}
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={(next) => onOpenChange(value, next)}
        contentClassName="max-h-80 overflow-y-auto"
      >
        {children}
      </CollapsibleSection>
    </div>
  );
}

export function IssueDetailTabs(props: IssueDetailTabsProps) {
  const {
    activeIssue,
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
  const openFindings = reviewFindings.filter((finding) => finding.status === 'open').length;
  const [openCards, setOpenCards] = useState<Set<IssueDetailTab>>(() => new Set(['prd']));

  useEffect(() => {
    if (!commentComposerRequestId) return;
    setOpenCards((current) => {
      if (current.has('comments')) return current;
      const next = new Set(current);
      next.add('comments');
      return next;
    });
    onActiveTabChange('comments');
  }, [commentComposerRequestId, onActiveTabChange]);

  function handleCardOpenChange(value: IssueDetailTab, open: boolean) {
    setOpenCards((current) => {
      const next = new Set(current);
      if (open) next.add(value);
      else next.delete(value);
      return next;
    });
    if (open) onActiveTabChange(value);
  }

  return (
    <div className="space-y-3" data-testid="issue-context-cards">
      <ContextCard
        value="prd"
        title="Issue"
        defaultOpen
        open={openCards.has('prd')}
        onOpenChange={handleCardOpenChange}
      >
        <PrdTab
          activeIssue={activeIssue}
          isRefreshingFromGithub={isRefreshingFromGithub}
          onEditPrd={onEditPrd}
          onRefreshFromGithub={onRefreshFromGithub}
        />
      </ContextCard>

      <ContextCard
        value="console"
        title="Console"
        open={openCards.has('console')}
        onOpenChange={handleCardOpenChange}
      >
        <ConsoleTab
          activeThreadId={activeThreadId}
          approvedAwaitingExecution={approvedAwaitingExecution}
          threadPhase={threadPhase}
        />
      </ContextCard>

      {activeIssue.isQuickMode ? null : (
        <ContextCard
          value="comments"
          title="Comments"
          open={openCards.has('comments')}
          onOpenChange={handleCardOpenChange}
        >
          <CommentsTab
            projectId={projectId}
            issueNumber={activeIssue.issueNumber}
            focusComposerRequestId={commentComposerRequestId}
          />
        </ContextCard>
      )}

      <ContextCard
        value="history"
        title="Plans"
        count={normalizedPlanHistory.length > 0 ? normalizedPlanHistory.length : undefined}
        open={openCards.has('history')}
        onOpenChange={handleCardOpenChange}
      >
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
      </ContextCard>

      {activeThreadId ? (
        <ContextCard
          value="findings"
          title="Findings"
          count={openFindings > 0 ? openFindings : undefined}
          open={openCards.has('findings')}
          onOpenChange={handleCardOpenChange}
        >
          <FindingsTab threadId={activeThreadId} findings={reviewFindings} />
        </ContextCard>
      ) : null}

      {activeThreadId ? (
        <ContextCard
          value="diff"
          title="Diff"
          count={diffs.length > 0 ? diffs.length : undefined}
          open={openCards.has('diff')}
          onOpenChange={handleCardOpenChange}
        >
          <DiffTab diffs={diffs} threadStatus={props.thread?.status} />
        </ContextCard>
      ) : null}

      {activeThreadId ? (
        <ContextCard
          value="runs"
          title="Runs"
          open={openCards.has('runs')}
          onOpenChange={handleCardOpenChange}
        >
          <RunsTab threadId={activeThreadId} />
        </ContextCard>
      ) : null}

      <ContextCard
        value="activity"
        title="Activity"
        count={normalizedIssueActivity.length > 0 ? normalizedIssueActivity.length : undefined}
        open={openCards.has('activity')}
        onOpenChange={handleCardOpenChange}
      >
        <IssueHistoryTab
          normalizedIssueActivity={normalizedIssueActivity}
          runNumberByThreadId={runNumberByThreadId}
        />
      </ContextCard>

      {activeThreadId ? (
        <ContextCard
          value="conversations"
          title="Transcript"
          open={openCards.has('conversations')}
          onOpenChange={handleCardOpenChange}
        >
          <ConversationsTab
            threadId={activeThreadId}
            projectId={projectId}
            issueNumber={activeIssue.issueNumber}
          />
        </ContextCard>
      ) : null}
    </div>
  );
}
