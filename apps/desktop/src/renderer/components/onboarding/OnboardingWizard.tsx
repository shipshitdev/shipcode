import { useState, useEffect } from 'react';
import type {
  AgentType,
  GhAuthStatus,
  Project,
  StatusLabelMapping,
  SystemHealth,
} from '@shipcode/shared';
import { DEFAULT_STATUS_LABEL_MAPPINGS, CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { Button, Card } from '@shipcode/ui';
import { StepAuthCheck, useAuthCheck } from './StepAuthCheck';
import { StepGitHubProject } from './StepGitHubProject';
import { StepModelPrefs } from './StepModelPrefs';
import { StepLabelMapping } from './StepLabelMapping';

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ['AI Auth', 'GitHub', 'Models', 'Labels'];

interface AuthResult extends SystemHealth {
  ghAuth: GhAuthStatus;
}

interface Props {
  onComplete: (projectId?: string) => void | Promise<void>;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [plannerModel, setPlannerModel] = useState<AgentType>('claude');
  const [reviewerModel, setReviewerModel] = useState<AgentType>('codex');
  const [labelMappings, setLabelMappings] = useState<StatusLabelMapping>(
    DEFAULT_STATUS_LABEL_MAPPINGS,
  );

  const authCheck = useAuthCheck();
  const [saving, setSaving] = useState(false);

  // Run auth check on mount
  useEffect(() => {
    authCheck.mutate(undefined, {
      onSuccess: (data) => setAuthResult(data),
    });
  }, []);

  const aiAuthCount = [authResult?.claude.authenticated, authResult?.codex.authenticated].filter(
    Boolean,
  ).length;
  const ghAuthenticated = !!authResult?.ghAuth.authenticated;
  // GitHub is mandatory: shipcode uses GitHub issues as the PRD/work-item store
  // and the `shipping` phase only creates PRs when a GitHub issue exists.
  const canAdvanceFromAuth = aiAuthCount >= 1 && ghAuthenticated;
  const singleAgentMode = aiAuthCount === 1;

  function handleRecheck() {
    authCheck.mutate(undefined, {
      onSuccess: (data) => setAuthResult(data),
    });
  }

  function handleNext() {
    if (step < 3) {
      setStep((step + 1) as Step);
    }
  }

  function handleBack() {
    if (step > 0) {
      setStep((step - 1) as Step);
    }
  }

  async function handleFinish() {
    setSaving(true);
    try {
      await window.shipcode.invoke('settings:set', {
        plannerModel,
        reviewerModel,
        statusLabelMappings: labelMappings,
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
      });
      let newProjectId: string | undefined;
      if (selectedRepo) {
        const localPath = await window.shipcode.invoke<string | null>('dialog:open-directory');
        if (localPath) {
          const project = await window.shipcode.invoke<Project>('project:add', { path: localPath });
          newProjectId = project.id;
        }
      }
      await onComplete(newProjectId);
    } finally {
      setSaving(false);
    }
  }

  const canNext = step === 0 ? canAdvanceFromAuth : step === 1 ? selectedRepo !== null : true;
  const isLastStep = step === 3;

  return (
    <div className="flex items-center justify-center h-screen bg-primary [app-region:drag]">
      <Card className="w-[520px] max-h-[80vh] flex flex-col overflow-hidden [app-region:no-drag]">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <h2 className="text-lg font-bold mb-4">Welcome to ShipCode</h2>
          <div className="flex gap-6">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 text-xs ${
                  i === step ? 'text-accent' : i < step ? 'text-success' : 'text-muted'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    i === step ? 'bg-accent' : i < step ? 'bg-success' : 'bg-text-muted'
                  }`}
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <StepAuthCheck
              authResult={authResult}
              onRecheck={handleRecheck}
              isChecking={authCheck.isPending}
            />
          )}
          {step === 1 && (
            <StepGitHubProject
              selectedRepo={selectedRepo}
              onSelect={(repo) => {
                setSelectedRepo(repo);
                handleNext();
              }}
            />
          )}
          {step === 2 && (
            <StepModelPrefs
              plannerModel={plannerModel}
              reviewerModel={reviewerModel}
              onChange={(p, r) => {
                setPlannerModel(p);
                setReviewerModel(r);
              }}
              singleAgentMode={singleAgentMode}
            />
          )}
          {step === 3 && <StepLabelMapping mappings={labelMappings} onChange={setLabelMappings} />}
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
          {step > 0 && (
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
          <div className="flex-1" />
          {isLastStep ? (
            <Button onClick={handleFinish} disabled={saving}>
              {saving ? 'Saving...' : 'Finish Setup'}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canNext}>
              Next
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
