import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '../test-helpers'
import { ProjectQueries } from './projects'
import { ThreadQueries } from './threads'

describe('ThreadQueries', () => {
	let db: DatabaseSync
	let projects: ProjectQueries
	let threads: ThreadQueries
	let projectId: string

	beforeEach(() => {
		db = createTestDb()
		projects = new ProjectQueries(db)
		threads = new ThreadQueries(db)
		projectId = projects.add('/tmp/test-project').id
	})

	afterEach(() => {
		db.close()
	})

	it('create() returns a thread with idle status', () => {
		const t = threads.create(projectId, 'fix the bug', 'Bug fix')
		expect(t.id).toBeTruthy()
		expect(t.projectId).toBe(projectId)
		expect(t.prompt).toBe('fix the bug')
		expect(t.title).toBe('Bug fix')
		expect(t.status).toBe('idle')
	})

	it('list() returns threads for a project', () => {
		threads.create(projectId, 'a', 'Thread A')
		threads.create(projectId, 'b', 'Thread B')

		const other = projects.add('/tmp/other').id
		threads.create(other, 'c', 'Thread C')

		const list = threads.list(projectId)
		expect(list.length).toBe(2)
	})

	it('getById() returns thread or null', () => {
		const t = threads.create(projectId, 'a', 'A')
		expect(threads.getById(t.id)).toMatchObject({ id: t.id })
		expect(threads.getById('nonexistent')).toBeNull()
	})

	it('updateStatus() changes the status', () => {
		const t = threads.create(projectId, 'a', 'A')
		threads.updateStatus(t.id, 'planning')
		expect(threads.getById(t.id)!.status).toBe('planning')
	})

	it('setWorktree() and clearWorktree()', () => {
		const t = threads.create(projectId, 'a', 'A')
		threads.setWorktree(t.id, 'feat/branch', '/tmp/wt')
		let updated = threads.getById(t.id)!
		expect(updated.worktreeBranch).toBe('feat/branch')
		expect(updated.worktreePath).toBe('/tmp/wt')

		threads.clearWorktree(t.id)
		updated = threads.getById(t.id)!
		expect(updated.worktreeBranch).toBeNull()
		expect(updated.worktreePath).toBeNull()
	})

	it('updateAutonomousFields() sets all autonomous fields', () => {
		const t = threads.create(projectId, 'a', 'A')
		threads.updateAutonomousFields(t.id, {
			autonomous: true,
			reviewRound: 2,
			executorModel: 'gpt-4',
			baseBranch: 'main',
			forkPointSha: 'abc123',
		})
		const updated = threads.getById(t.id)!
		expect(updated.autonomous).toBe(true)
		expect(updated.reviewRound).toBe(2)
		expect(updated.executorModel).toBe('gpt-4')
		expect(updated.baseBranch).toBe('main')
		expect(updated.forkPointSha).toBe('abc123')
	})

	it('incrementReviewRound() increments by 1', () => {
		const t = threads.create(projectId, 'a', 'A')
		expect(threads.getById(t.id)!.reviewRound).toBe(0)
		threads.incrementReviewRound(t.id)
		expect(threads.getById(t.id)!.reviewRound).toBe(1)
		threads.incrementReviewRound(t.id)
		expect(threads.getById(t.id)!.reviewRound).toBe(2)
	})

	it('setGithubIssue() and setGithubPr()', () => {
		const t = threads.create(projectId, 'a', 'A')
		threads.setGithubIssue(t.id, 42, 'owner/repo')
		let updated = threads.getById(t.id)!
		expect(updated.githubIssueNumber).toBe(42)
		expect(updated.githubRepo).toBe('owner/repo')

		threads.setGithubPr(t.id, 99)
		updated = threads.getById(t.id)!
		expect(updated.githubPrNumber).toBe(99)
	})

	it('hasActivePipeline() returns true when active statuses exist', () => {
		expect(threads.hasActivePipeline(projectId)).toBe(false)

		const t = threads.create(projectId, 'a', 'A')
		threads.updateStatus(t.id, 'planning')
		expect(threads.hasActivePipeline(projectId)).toBe(true)
	})

	it('hasActivePipeline() returns false for idle/done statuses', () => {
		const t = threads.create(projectId, 'a', 'A')
		threads.updateStatus(t.id, 'idle')
		expect(threads.hasActivePipeline(projectId)).toBe(false)
	})
})
