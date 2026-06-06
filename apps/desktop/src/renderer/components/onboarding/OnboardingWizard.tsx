import type { AgentType, GhAuthStatus, SystemHealth } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { Button, Card } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useEffect, useReducer } from 'react';
import { StepAuthCheck, useAuthCheck } from './StepAuthCheck';
import { StepModelPrefs } from './StepModelPrefs';

type Step = 0 | 1 | 2;

const STEP_LABELS = ['AI Auth', 'Models', 'GitHub'];

export function StepGitHubReadiness() {
  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-2">GitHub readiness</h3>
      <p className="text-secondary text-[13px] mb-4 leading-relaxed">
        ShipCode owns the <code>shipcode:*</code> labels. When a repository is added, ShipCode
        repairs those labels and checks that issue metadata lives in GitHub issue types and Projects
        fields.
      </p>
      <div className="space-y-2 text-[12px]">
        {[
          ['Labels', 'shipcode:* only'],
          ['Issue type', 'Feature'],
          ['Status', 'Todo, In Progress, Human Review, Done, Deferred'],
          ['Priority', 'P0, P1, P2, P3'],
          ['Complexity', 'Low, Medium, High'],
          ['Blast radius', 'Contained, Cross-Package, Cross-App, Infra'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-md bg-tertiary px-3 py-2"
          >
            <span className="font-medium text-primary">{label}</span>
            <span className="text-right font-mono text-[11px] text-muted-foreground">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12px] italic text-muted-foreground">
        Product taxonomy should be an Area or Component field, not repo labels.
      </p>
    </div>
  );
}

interface AuthResult extends SystemHealth {
  ghAuth: GhAuthStatus;
}

interface Props {
  onComplete: () => void | Promise<void>;
}

interface OnboardingState {
  step: Step;
  authResult: AuthResult | null;
  plannerModel: AgentType;
  reviewerModel: AgentType;
  saving: boolean;
}

type OnboardingAction =
  | { type: 'auth-result'; result: AuthResult }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'models'; plannerModel: AgentType; reviewerModel: AgentType }
  | { type: 'saving'; saving: boolean };

const INITIAL_ONBOARDING_STATE: OnboardingState = {
  step: 0,
  authResult: null,
  plannerModel: 'claude',
  reviewerModel: 'codex',
  saving: false,
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'auth-result':
      return { ...state, authResult: action.result };
    case 'next':
      return { ...state, step: Math.min(2, state.step + 1) as Step };
    case 'back':
      return { ...state, step: Math.max(0, state.step - 1) as Step };
    case 'models':
      return {
        ...state,
        plannerModel: action.plannerModel,
        reviewerModel: action.reviewerModel,
      };
    case 'saving':
      return { ...state, saving: action.saving };
  }
}

export function OnboardingWizard({ onComplete }: Props) {
  const [{ step, authResult, plannerModel, reviewerModel, saving }, dispatch] = useReducer(
    onboardingReducer,
    INITIAL_ONBOARDING_STATE,
  );

  const authCheck = useAuthCheck();
  const { mutate: runAuthCheck } = authCheck;

  // Run auth check once on mount
  useEffect(() => {
    runAuthCheck(undefined, {
      onSuccess: (data) => dispatch({ type: 'auth-result', result: data }),
    });
  }, [runAuthCheck]);

  const aiAuthCount = [authResult?.claude.authenticated, authResult?.codex.authenticated].filter(
    Boolean,
  ).length;
  const canAdvanceFromAuth = aiAuthCount >= 1;
  const singleAgentMode = aiAuthCount === 1;

  function handleRecheck() {
    runAuthCheck(undefined, {
      onSuccess: (data) => dispatch({ type: 'auth-result', result: data }),
    });
  }

  function handleNext() {
    dispatch({ type: 'next' });
  }

  function handleBack() {
    dispatch({ type: 'back' });
  }

  async function handleFinish() {
    dispatch({ type: 'saving', saving: true });
    try {
      await window.shipcode.invoke('settings:set', {
        plannerModel,
        reviewerModel,
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
      });
      await onComplete();
    } finally {
      dispatch({ type: 'saving', saving: false });
    }
  }

  const canNext = step === 0 ? canAdvanceFromAuth : true;
  const isLastStep = step === 2;

  return (
    <div
      data-testid="onboarding-wizard"
      className="flex items-center justify-center h-screen bg-primary [app-region:drag]"
    >
      <Card className="w-[520px] max-h-[80vh] flex flex-col overflow-hidden [app-region:no-drag]">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <h2 className="mb-4 text-lg font-semibold">Welcome to ShipCode</h2>
          <div className="flex gap-6">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 text-xs ${
                  i === step ? 'text-accent' : i < step ? 'text-success' : 'text-muted-foreground'
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    i === step ? 'bg-accent' : i < step ? 'bg-success' : 'bg-text-muted-foreground'
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
            <StepModelPrefs
              plannerModel={plannerModel}
              reviewerModel={reviewerModel}
              onChange={(p, r) => {
                dispatch({ type: 'models', plannerModel: p, reviewerModel: r });
              }}
              singleAgentMode={singleAgentMode}
            />
          )}
          {step === 2 && <StepGitHubReadiness />}
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-border">
          {step > 0 && (
            <Button data-testid="onboarding-back-btn" variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
          <div className="flex-1" />
          {isLastStep ? (
            <Button data-testid="onboarding-finish-btn" onClick={handleFinish} disabled={saving}>
              <LoadingButtonContent loading={saving}>Finish Setup</LoadingButtonContent>
            </Button>
          ) : (
            <Button data-testid="onboarding-next-btn" onClick={handleNext} disabled={!canNext}>
              Next
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
