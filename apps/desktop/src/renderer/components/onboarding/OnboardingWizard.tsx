import type { AgentType, GhAuthStatus, StatusLabelMapping, SystemHealth } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION, DEFAULT_STATUS_LABEL_MAPPINGS } from '@shipcode/shared';
import { Button, Card, LoadingButtonContent } from '@shipshitdev/ui';
import { useEffect, useState } from 'react';
import { StepAuthCheck, useAuthCheck } from './StepAuthCheck';
import { StepLabelMapping } from './StepLabelMapping';
import { StepModelPrefs } from './StepModelPrefs';

type Step = 0 | 1 | 2;

const STEP_LABELS = ['AI Auth', 'Models', 'Labels'];

interface AuthResult extends SystemHealth {
  ghAuth: GhAuthStatus;
}

interface Props {
  onComplete: () => void | Promise<void>;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const [plannerModel, setPlannerModel] = useState<AgentType>('claude');
  const [reviewerModel, setReviewerModel] = useState<AgentType>('codex');
  const [labelMappings, setLabelMappings] = useState<StatusLabelMapping>(
    DEFAULT_STATUS_LABEL_MAPPINGS,
  );

  const authCheck = useAuthCheck();
  const [saving, setSaving] = useState(false);
  const { mutate: runAuthCheck } = authCheck;

  // Run auth check once on mount
  useEffect(() => {
    runAuthCheck(undefined, {
      onSuccess: (data) => setAuthResult(data),
    });
  }, [runAuthCheck]);

  const aiAuthCount = [authResult?.claude.authenticated, authResult?.codex.authenticated].filter(
    Boolean,
  ).length;
  const canAdvanceFromAuth = aiAuthCount >= 1;
  const singleAgentMode = aiAuthCount === 1;

  function handleRecheck() {
    runAuthCheck(undefined, {
      onSuccess: (data) => setAuthResult(data),
    });
  }

  function handleNext() {
    if (step < 2) {
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
      await onComplete();
    } finally {
      setSaving(false);
    }
  }

  const canNext = step === 0 ? canAdvanceFromAuth : true;
  const isLastStep = step === 2;

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
          {step === 2 && <StepLabelMapping mappings={labelMappings} onChange={setLabelMappings} />}
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
              <LoadingButtonContent loading={saving}>Finish Setup</LoadingButtonContent>
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
