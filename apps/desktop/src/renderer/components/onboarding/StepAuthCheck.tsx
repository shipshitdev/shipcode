import { useMutation } from '@tanstack/react-query'
import type { CliHealth, GhAuthStatus, SystemHealth } from '@shipcode/shared'

interface AuthResult extends SystemHealth {
	ghAuth: GhAuthStatus
}

interface Props {
	authResult: AuthResult | null
	onRecheck: () => void
	isChecking: boolean
}

function CliStatus({ label, health }: { label: string; health: CliHealth }) {
	return (
		<div className="onboarding__auth-row">
			<span className="onboarding__auth-tool">{label}</span>
			<span className="onboarding__auth-status">
				{!health.available ? (
					<span className="onboarding__badge onboarding__badge--danger">Not installed</span>
				) : health.authenticated ? (
					<span className="onboarding__badge onboarding__badge--success">Authenticated</span>
				) : (
					<span className="onboarding__badge onboarding__badge--warning">Not authenticated</span>
				)}
			</span>
			{health.version && (
				<span className="onboarding__auth-version">{health.version}</span>
			)}
		</div>
	)
}

export function StepAuthCheck({ authResult, onRecheck, isChecking }: Props) {
	const claudeAuth = authResult?.claude
	const codexAuth = authResult?.codex
	const ghAuth = authResult?.ghAuth

	const aiAuthCount = [claudeAuth?.authenticated, codexAuth?.authenticated].filter(Boolean).length

	return (
		<div className="onboarding__step">
			<h3>Connect your AI agents</h3>
			<p className="onboarding__description">
				ShipCode uses CLI tools to orchestrate AI coding agents. Authenticate at least one AI CLI to proceed.
			</p>

			{authResult ? (
				<div className="onboarding__auth-list">
					<CliStatus label="Claude CLI" health={authResult.claude} />
					<CliStatus label="Codex CLI" health={authResult.codex} />
					<div className="onboarding__auth-row">
						<span className="onboarding__auth-tool">GitHub CLI</span>
						<span className="onboarding__auth-status">
							{!ghAuth?.installed ? (
								<span className="onboarding__badge onboarding__badge--danger">Not installed</span>
							) : ghAuth?.authenticated ? (
								<span className="onboarding__badge onboarding__badge--success">
									{ghAuth.username ? `@${ghAuth.username}` : 'Authenticated'}
								</span>
							) : (
								<span className="onboarding__badge onboarding__badge--warning">Not authenticated</span>
							)}
						</span>
					</div>
				</div>
			) : (
				<div className="onboarding__loading">Checking CLI status...</div>
			)}

			{authResult && aiAuthCount === 1 && (
				<div className="onboarding__warning">
					Adversarial review requires both Claude and Codex. You can proceed in single-agent mode, but plan review will be skipped.
				</div>
			)}

			{authResult && aiAuthCount === 0 && (
				<div className="onboarding__instructions">
					<p>Run these commands to authenticate:</p>
					<code>claude login</code>
					<code>codex login</code>
					<code>gh auth login</code>
				</div>
			)}

			<div className="onboarding__actions">
				<button
					type="button"
					className="btn btn--secondary"
					onClick={onRecheck}
					disabled={isChecking}
				>
					{isChecking ? 'Checking...' : 'Re-check'}
				</button>
			</div>
		</div>
	)
}

export function useAuthCheck() {
	return useMutation({
		mutationFn: () => window.shipcode.invoke<AuthResult>('onboarding:check-auth'),
	})
}
