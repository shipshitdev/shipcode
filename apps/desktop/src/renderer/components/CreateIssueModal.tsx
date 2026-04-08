import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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

export function CreateIssueModal() {
	const queryClient = useQueryClient()
	const { createIssueModalOpen, closeCreateIssueModal, activeProjectId } = useAppStore()
	const [title, setTitle] = useState('')
	const [body, setBody] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const titleRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (createIssueModalOpen) {
			setTitle('')
			setBody('')
			setError(null)
			setTimeout(() => titleRef.current?.focus(), 50)
		}
	}, [createIssueModalOpen])

	if (!activeProjectId) return null

	const handleSubmit = async () => {
		if (!title.trim()) return
		setSubmitting(true)
		setError(null)
		try {
			await window.shipcode.invoke('github:create-issue', {
				projectId: activeProjectId,
				title: title.trim(),
				body: body.trim() || undefined,
			})
			queryClient.invalidateQueries({ queryKey: ['github-issues'] })
			closeCreateIssueModal()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create issue')
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
			handleSubmit()
		}
	}

	return (
		<Dialog open={createIssueModalOpen} onOpenChange={(open) => { if (!open) closeCreateIssueModal() }}>
			<DialogContent className="max-w-[480px]" onKeyDown={handleKeyDown}>
				<DialogHeader>
					<DialogTitle>Create GitHub Issue</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<Label htmlFor="issue-title" className="text-xs text-text-secondary">Title</Label>
						<Input
							ref={titleRef}
							id="issue-title"
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Issue title..."
						/>
					</div>

					<div className="flex flex-col gap-1">
						<Label htmlFor="issue-body" className="text-xs text-text-secondary">Description</Label>
						<Textarea
							id="issue-body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Optional description..."
							rows={6}
						/>
					</div>

					{error && (
						<div className="rounded-md border border-[#5c1f1f] bg-[#3d1111] px-2.5 py-2 text-xs text-danger">
							{error}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="secondary"
						onClick={closeCreateIssueModal}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!title.trim() || submitting}
					>
						{submitting ? 'Creating...' : 'Create Issue'}
					</Button>
					<span className="ml-auto text-[11px] text-text-muted">Cmd+Enter to submit</span>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
