import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PRD_TEMPLATE, PRD_REQUIRED_HEADINGS, bodyHasRequiredPrdSections } from '@shipcode/shared'
import { useAppStore } from '../stores/app-store'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
	Input,
	Textarea,
	Label,
	Button,
} from '@shipcode/ui'

type Step = 'idea' | 'review'

export function CreateIssueModal() {
	const queryClient = useQueryClient()
	const { createIssueModalOpen, closeCreateIssueModal, activeProjectId, editingPrd } = useAppStore()
	const [step, setStep] = useState<Step>('idea')
	const [idea, setIdea] = useState('')
	const [title, setTitle] = useState('')
	const [body, setBody] = useState('')
	const [generating, setGenerating] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const ideaRef = useRef<HTMLTextAreaElement>(null)
	const titleRef = useRef<HTMLInputElement>(null)
	const bodyRef = useRef<HTMLTextAreaElement>(null)

	const mode: 'create' | 'edit' = editingPrd ? 'edit' : 'create'

	useEffect(() => {
		if (!createIssueModalOpen) return
		if (mode === 'edit' && editingPrd) {
			setStep('review')
			setIdea('')
			setTitle('')
			setBody(editingPrd.body)
			setError(null)
			setTimeout(() => bodyRef.current?.focus(), 50)
		} else {
			setStep('idea')
			setIdea('')
			setTitle('')
			setBody('')
			setError(null)
			setTimeout(() => ideaRef.current?.focus(), 50)
		}
	}, [createIssueModalOpen, mode, editingPrd])

	if (!activeProjectId) return null

	const bodyValid = bodyHasRequiredPrdSections(body)
	const missingSections = PRD_REQUIRED_HEADINGS.filter((h) => !body.includes(h))

	const handleGenerate = async () => {
		if (!idea.trim() || !activeProjectId) return
		setGenerating(true)
		setError(null)
		try {
			const result = await window.shipcode.invoke<{ title: string; body: string }>(
				'ai:generate-prd',
				{ projectId: activeProjectId, userPrompt: idea.trim() },
			)
			setTitle(result.title)
			setBody(result.body)
			setStep('review')
			setTimeout(() => titleRef.current?.focus(), 50)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'PRD generation failed')
		} finally {
			setGenerating(false)
		}
	}

	const handleStartManual = () => {
		setTitle('')
		setBody(PRD_TEMPLATE)
		setStep('review')
		setTimeout(() => titleRef.current?.focus(), 50)
	}

	const handleSubmit = async () => {
		if (mode === 'create' && !title.trim()) return
		if (!bodyValid) return
		setSubmitting(true)
		setError(null)
		try {
			if (mode === 'edit' && editingPrd) {
				await window.shipcode.invoke('github:edit-issue-body', {
					projectId: activeProjectId,
					issueNumber: editingPrd.issueNumber,
					body,
				})
			} else {
				await window.shipcode.invoke('github:create-issue', {
					projectId: activeProjectId,
					title: title.trim(),
					body,
				})
			}
			queryClient.invalidateQueries({ queryKey: ['github-issues'] })
			closeCreateIssueModal()
		} catch (err) {
			const verb = mode === 'edit' ? 'update' : 'create'
			setError(err instanceof Error ? err.message : `Failed to ${verb} PRD`)
		} finally {
			setSubmitting(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault()
			closeCreateIssueModal()
		}
		if (e.metaKey && e.key === 'Enter') {
			e.preventDefault()
			if (step === 'idea' && idea.trim()) {
				handleGenerate()
			} else if (step === 'review') {
				handleSubmit()
			}
		}
	}

	const titleInvalid = mode === 'create' && !title.trim()
	const submitDisabled = titleInvalid || !bodyValid || submitting
	const submitLabel = submitting
		? mode === 'edit'
			? 'Saving...'
			: 'Creating...'
		: mode === 'edit'
			? 'Save PRD'
			: 'Create PRD'

	const dialogTitle =
		mode === 'edit' ? 'Edit PRD' : step === 'idea' ? 'New PRD' : 'Review PRD'

	return (
		<Dialog open={createIssueModalOpen} onOpenChange={(open) => { if (!open) closeCreateIssueModal() }}>
			<DialogContent className="max-w-[720px]" onKeyDown={handleKeyDown}>
				<DialogHeader>
					<DialogTitle>{dialogTitle}</DialogTitle>
				</DialogHeader>

				{step === 'idea' && mode === 'create' && (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1">
							<Label htmlFor="idea" className="text-xs text-text-secondary">
								What do you want to build?
							</Label>
							<Textarea
								ref={ideaRef}
								id="idea"
								value={idea}
								onChange={(e) => setIdea(e.target.value)}
								placeholder={
									'Free-form. A paragraph or a few bullets.\n\n' +
									'Example: "Add a keyboard shortcut (cmd+shift+c) that copies the\n' +
									"active kanban card's GitHub issue URL. Should show a toast to\n" +
									'confirm. Only copy the URL, nothing else."'
								}
								rows={10}
								className="text-[13px]"
							/>
							<p className="text-[11px] text-text-muted">
								The AI reads{' '}
								<code className="font-mono">.agents/skills/writing-prds/SKILL.md</code> from this repo
								and expands your idea into a full PRD (title + structured body). You review and edit before submitting to GitHub.
							</p>
						</div>

						{error && (
							<div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
								{error}
							</div>
						)}
					</div>
				)}

				{step === 'review' && (
					<div className="flex flex-col gap-3">
						{mode === 'create' && (
							<div className="flex flex-col gap-1">
								<Label htmlFor="issue-title" className="text-xs text-text-secondary">
									Title
								</Label>
								<Input
									ref={titleRef}
									id="issue-title"
									type="text"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="Human-readable issue title..."
								/>
							</div>
						)}

						<div className="flex flex-col gap-1">
							<Label htmlFor="issue-body" className="text-xs text-text-secondary">
								PRD body{' '}
								<span className="text-text-muted">
									(edit freely — all required sections must remain)
								</span>
							</Label>
							<Textarea
								ref={bodyRef}
								id="issue-body"
								value={body}
								onChange={(e) => setBody(e.target.value)}
								placeholder="PRD markdown..."
								rows={22}
								className="font-mono text-xs"
							/>
						</div>

						{!bodyValid && body.length > 0 && (
							<div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
								Missing required sections: {missingSections.join(', ')}
							</div>
						)}

						{error && (
							<div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
								{error}
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					{step === 'idea' && mode === 'create' ? (
						<>
							<Button variant="secondary" onClick={closeCreateIssueModal} disabled={generating}>
								Cancel
							</Button>
							<Button variant="ghost" onClick={handleStartManual} disabled={generating}>
								Write manually
							</Button>
							<Button onClick={handleGenerate} disabled={!idea.trim() || generating}>
								{generating ? 'Generating…' : 'Generate with AI'}
							</Button>
							<span className="ml-auto text-[11px] text-text-muted">⌘↩ to generate</span>
						</>
					) : (
						<>
							{mode === 'create' && (
								<Button variant="ghost" onClick={() => setStep('idea')} disabled={submitting}>
									← Back
								</Button>
							)}
							<Button variant="secondary" onClick={closeCreateIssueModal} disabled={submitting}>
								Cancel
							</Button>
							<Button onClick={handleSubmit} disabled={submitDisabled}>
								{submitLabel}
							</Button>
							<span className="ml-auto text-[11px] text-text-muted">⌘↩ to submit</span>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
