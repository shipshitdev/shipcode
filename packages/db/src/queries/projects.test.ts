import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '../test-helpers'
import { ProjectQueries } from './projects'

describe('ProjectQueries', () => {
	let db: DatabaseSync
	let projects: ProjectQueries

	beforeEach(() => {
		db = createTestDb()
		projects = new ProjectQueries(db)
	})

	afterEach(() => {
		db.close()
	})

	it('add() creates a project with basename as name', () => {
		const p = projects.add('/home/user/my-project')
		expect(p.id).toBeTruthy()
		expect(p.name).toBe('my-project')
		expect(p.path).toBe('/home/user/my-project')
		expect(p.defaultBranch).toBe('main')
		expect(p.createdAt).toBeTruthy()
		expect(p.updatedAt).toBeTruthy()
	})

	it('getById() returns project or null', () => {
		const p = projects.add('/tmp/a')
		expect(projects.getById(p.id)).toMatchObject({ id: p.id })
		expect(projects.getById('nonexistent')).toBeNull()
	})

	it('list() returns projects ordered by updated_at DESC', () => {
		const p1 = projects.add('/tmp/first')
		// Manually backdate p1 so p2 is definitively newer
		db.prepare("UPDATE projects SET updated_at = datetime('now', '-1 hour') WHERE id = ?").run(p1.id)
		const p2 = projects.add('/tmp/second')
		const list = projects.list()
		expect(list.length).toBe(2)
		expect(list[0].id).toBe(p2.id)
		expect(list[1].id).toBe(p1.id)
	})

	it('remove() deletes the project', () => {
		const p = projects.add('/tmp/a')
		projects.remove(p.id)
		expect(projects.getById(p.id)).toBeNull()
	})

	it('remove() cascades to threads', () => {
		const p = projects.add('/tmp/a')
		db.prepare(
			"INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', ?, 'title', 'prompt')"
		).run(p.id)
		projects.remove(p.id)
		const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get('t1')
		expect(thread).toBeUndefined()
	})

	it('updateGitInfo() updates git_remote and default_branch', () => {
		const p = projects.add('/tmp/a')
		projects.updateGitInfo(p.id, 'git@github.com:foo/bar.git', 'develop')
		const updated = projects.getById(p.id)!
		expect(updated.gitRemote).toBe('git@github.com:foo/bar.git')
		expect(updated.defaultBranch).toBe('develop')
	})

	it('unique path constraint throws on duplicate', () => {
		projects.add('/tmp/same')
		expect(() => projects.add('/tmp/same')).toThrow()
	})
})
