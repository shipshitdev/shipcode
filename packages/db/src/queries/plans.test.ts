import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '../test-helpers'
import { ProjectQueries } from './projects'
import { ThreadQueries } from './threads'
import { PlanQueries } from './plans'

describe('PlanQueries', () => {
	let db: DatabaseSync
	let plans: PlanQueries
	let threadId: string

	beforeEach(() => {
		db = createTestDb()
		const projects = new ProjectQueries(db)
		const threads = new ThreadQueries(db)
		const projectId = projects.add('/tmp/test').id
		threadId = threads.create(projectId, 'prompt', 'title').id
		plans = new PlanQueries(db)
	})

	afterEach(() => {
		db.close()
	})

	it('create() returns a plan record', () => {
		const p = plans.create(threadId, 'raw output', null, 1)
		expect(p.id).toBeTruthy()
		expect(p.threadId).toBe(threadId)
		expect(p.rawOutput).toBe('raw output')
		expect(p.structured).toBeNull()
		expect(p.version).toBe(1)
		expect(p.status).toBe('draft')
	})

	it('getMaxVersion() returns 0 when no plans', () => {
		expect(plans.getMaxVersion(threadId)).toBe(0)
	})

	it('getMaxVersion() returns highest version', () => {
		plans.create(threadId, 'v1', null, 1)
		plans.create(threadId, 'v2', null, 2)
		expect(plans.getMaxVersion(threadId)).toBe(2)
	})

	it('getLatest() returns null when no plans', () => {
		expect(plans.getLatest(threadId)).toBeNull()
	})

	it('getLatest() returns highest version plan', () => {
		plans.create(threadId, 'v1', null, 1)
		const p2 = plans.create(threadId, 'v2', null, 2)
		expect(plans.getLatest(threadId)!.id).toBe(p2.id)
	})

	it('list() returns plans ordered by version DESC', () => {
		plans.create(threadId, 'v1', null, 1)
		plans.create(threadId, 'v2', null, 2)
		const list = plans.list(threadId)
		expect(list.length).toBe(2)
		expect(list[0].version).toBe(2)
		expect(list[1].version).toBe(1)
	})

	it('getById() returns plan or null', () => {
		const p = plans.create(threadId, 'raw', null, 1)
		expect(plans.getById(p.id)).toMatchObject({ id: p.id })
		expect(plans.getById('nonexistent')).toBeNull()
	})

	it('updateStatus() changes plan status', () => {
		const p = plans.create(threadId, 'raw', null, 1)
		plans.updateStatus(p.id, 'approved')
		expect(plans.getById(p.id)!.status).toBe('approved')
	})

	it('updateStructured() stores JSON', () => {
		const p = plans.create(threadId, 'raw', null, 1)
		const structured = { title: 'Plan', steps: [] } as any
		plans.updateStructured(p.id, structured)
		const updated = plans.getById(p.id)!
		expect(updated.structured).toEqual(structured)
	})

	it('supersedeAll() marks all non-superseded as superseded', () => {
		const p1 = plans.create(threadId, 'v1', null, 1)
		const p2 = plans.create(threadId, 'v2', null, 2)
		plans.updateStatus(p1.id, 'approved')

		plans.supersedeAll(threadId)

		expect(plans.getById(p1.id)!.status).toBe('superseded')
		expect(plans.getById(p2.id)!.status).toBe('superseded')
	})
})
