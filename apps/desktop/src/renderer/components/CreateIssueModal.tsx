import { useState, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'

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

	if (!createIssueModalOpen || !activeProjectId) return null

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
		<div className="create-issue-overlay" onKeyDown={handleKeyDown}>
			<div className="create-issue-backdrop" onClick={closeCreateIssueModal} />
			<div className="create-issue-modal">
				<h3 className="create-issue-modal__title">Create GitHub Issue</h3>

				<label className="create-issue-modal__label">
					Title
					<input
						ref={titleRef}
						className="create-issue-modal__input"
						type="text"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Issue title..."
					/>
				</label>

				<label className="create-issue-modal__label">
					Description
					<textarea
						className="create-issue-modal__textarea"
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="Optional description..."
						rows={6}
					/>
				</label>

				{error && <div className="create-issue-modal__error">{error}</div>}

				<div className="create-issue-modal__actions">
					<button
						type="button"
						className="btn btn--secondary"
						onClick={closeCreateIssueModal}
						disabled={submitting}
					>
						Cancel
					</button>
					<button
						type="button"
						className="btn btn--primary"
						onClick={handleSubmit}
						disabled={!title.trim() || submitting}
					>
						{submitting ? 'Creating...' : 'Create Issue'}
					</button>
					<span className="create-issue-modal__hint">⌘↩ to submit</span>
				</div>
			</div>
		</div>
	)
}
