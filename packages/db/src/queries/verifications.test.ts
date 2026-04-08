import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '../test-helpers'
import { ProjectQueries } from './projects'
import { ThreadQueries } from './threads'
import { PlanQueries } from './plans'
import { VerificationQueries } from './verifications'

describe('VerificationQueries', () => {
	let db: DatabaseSync
	let verifications: VerificationQueries
	let threadId: string
	let planId: string

	beforeEach(() => {
		db = createTestDb()
		const projects = new ProjectQueries(db)
		const threads = new ThreadQueries(db)
		const plans = new PlanQueries(db)
		const projectId = projects.add('/tmp/test').id
		threadId = threads.create(projectId, 'prompt', 'title').id
		planId = plans.create(threadId, 'raw', null, 1).id
		verifications = new VerificationQueries(db)
	})

	afterEach(() => {
		db.close()
	})

	it('create() returns a verification record', () => {
		const v = verifications.create(threadId, planId, 'output', null)
		expect(v.id).toBeTruthy()
		expect(v.threadId).toBe(threadId)
		expect(v.planId).toBe(planId)
		expect(v.rawOutput).toBe('output')
		expect(v.result).toBe('failed')
	})

	it('create() with structured uses its result', () => {
		const structured = { result: 'passed', details: 'all tests pass' } as any
		const v = verifications.create(threadId, planId, 'output', structured)
		expect(v.result).toBe('passed')
		expect(v.structured).toEqual(structured)
	})

	it('getByThreadId() returns records ordered by created_at ASC', () => {
		verifications.create(threadId, planId, 'first', null)
		verifications.create(threadId, planId, 'second', null)
		const list = verifications.getByThreadId(threadId)
		expect(list.length).toBe(2)
		expect(list[0].rawOutput).toBe('first')
		expect(list[1].rawOutput).toBe('second')
	})

	it('getLatest() returns most recent or null', () => {
		expect(verifications.getLatest(threadId)).toBeNull()

		const v1 = verifications.create(threadId, planId, 'first', null)
		// Backdate v1 so v2 is definitively newer
		db.prepare("UPDATE verifications SET created_at = datetime('now', '-1 hour') WHERE id = ?").run(v1.id)
		verifications.create(threadId, planId, 'second', null)
		const latest = verifications.getLatest(threadId)!
		expect(latest.rawOutput).toBe('second')
	})
})
