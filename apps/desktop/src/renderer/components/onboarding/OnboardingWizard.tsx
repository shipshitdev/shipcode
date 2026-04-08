import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { AgentType, AppSettings, GhAuthStatus, StatusLabelMapping, SystemHealth } from '@shipcode/shared'
import { DEFAULT_STATUS_LABEL_MAPPINGS, CURRENT_ONBOARDING_VERSION } from '@shipcode/shared'
import { StepAuthCheck, useAuthCheck } from './StepAuthCheck'
import { StepGitHubProject } from './StepGitHubProject'
import { StepModelPrefs } from './StepModelPrefs'
import { StepLabelMapping } from './StepLabelMapping'

type Step = 0 | 1 | 2 | 3

const STEP_LABELS = ['AI Auth', 'GitHub', 'Models', 'Labels']

interface AuthResult extends SystemHealth {
	ghAuth: GhAuthStatus
}

interface Props {
	onComplete: () => void
}

export function OnboardingWizard({ onComplete }: Props) {
	const [step, setStep] = useState<Step>(0)
	const [authResult, setAuthResult] = useState<AuthResult | null>(null)
	const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
	const [plannerModel, setPlannerModel] = useState<AgentType>('claude')
	const [reviewerModel, setReviewerModel] = useState<AgentType>('codex')
	const [labelMappings, setLabelMappings] = useState<StatusLabelMapping>(DEFAULT_STATUS_LABEL_MAPPINGS)

	const authCheck = useAuthCheck()
	const saveSettings = useMutation({
		mutationFn: (patch: Partial<AppSettings>) =>
			window.shipcode.invoke('settings:set', patch),
		onSuccess: onComplete,
	})

	// Run auth check on mount
	useEffect(() => {
		authCheck.mutate(undefined, {
			onSuccess: (data) => setAuthResult(data),
		})
	}, [])

	const aiAuthCount = [authResult?.claude.authenticated, authResult?.codex.authenticated].filter(Boolean).length
	const canAdvanceFromAuth = aiAuthCount >= 1
	const singleAgentMode = aiAuthCount === 1

	function handleRecheck() {
		authCheck.mutate(undefined, {
			onSuccess: (data) => setAuthResult(data),
		})
	}

	function handleNext() {
		if (step < 3) {
			setStep((step + 1) as Step)
		}
	}

	function handleBack() {
		if (step > 0) {
			setStep((step - 1) as Step)
		}
	}

	function handleFinish() {
		const patch: Partial<AppSettings> = {
			plannerModel,
			reviewerModel,
			statusLabelMappings: labelMappings,
			githubPollingEnabled: selectedRepo !== null,
			onboardingVersion: CURRENT_ONBOARDING_VERSION,
		}
		saveSettings.mutate(patch)
	}

	const canNext = step === 0 ? canAdvanceFromAuth : true
	const isLastStep = step === 3

	return (
		<div className="onboarding">
			<div className="onboarding__container">
				<div className="onboarding__header">
					<h2>Welcome to ShipCode</h2>
					<div className="onboarding__progress">
						{STEP_LABELS.map((label, i) => (
							<div
								key={label}
								className={`onboarding__progress-step ${
									i === step ? 'onboarding__progress-step--active' : ''
								} ${i < step ? 'onboarding__progress-step--done' : ''}`}
							>
								<span className="onboarding__progress-dot" />
								<span className="onboarding__progress-label">{label}</span>
							</div>
						))}
					</div>
				</div>

				<div className="onboarding__body">
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
								setSelectedRepo(repo)
								handleNext()
							}}
						/>
					)}
					{step === 2 && (
						<StepModelPrefs
							plannerModel={plannerModel}
							reviewerModel={reviewerModel}
							onChange={(p, r) => { setPlannerModel(p); setReviewerModel(r) }}
							singleAgentMode={singleAgentMode}
						/>
					)}
					{step === 3 && (
						<StepLabelMapping
							mappings={labelMappings}
							onChange={setLabelMappings}
						/>
					)}
				</div>

				<div className="onboarding__footer">
					{step > 0 && (
						<button type="button" className="btn btn--secondary" onClick={handleBack}>
							Back
						</button>
					)}
					<div className="onboarding__footer-spacer" />
					{isLastStep ? (
						<button
							type="button"
							className="btn btn--primary"
							onClick={handleFinish}
							disabled={saveSettings.isPending}
						>
							{saveSettings.isPending ? 'Saving...' : 'Finish Setup'}
						</button>
					) : (
						<button
							type="button"
							className="btn btn--primary"
							onClick={handleNext}
							disabled={!canNext}
						>
							Next
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
