import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '../test-helpers'
import { SettingsQueries } from './settings'

describe('SettingsQueries', () => {
	let db: DatabaseSync
	let settings: SettingsQueries

	beforeEach(() => {
		db = createTestDb()
		settings = new SettingsQueries(db)
	})

	afterEach(() => {
		db.close()
	})

	it('get() returns defaults when db is empty', () => {
		const s = settings.get()
		expect(s.theme).toBe('system')
		expect(s.defaultWorktreeEnabled).toBe(true)
		expect(s.terminalScrollback).toBe(10000)
		expect(s.plannerModel).toBe('claude')
		expect(s.reviewerModel).toBe('codex')
		expect(s.githubPollingEnabled).toBe(false)
		expect(s.githubPollingIntervalMs).toBe(30000)
		expect(s.githubBotUsername).toBe('')
		expect(s.autoPickupEnabled).toBe(false)
		expect(s.onboardingVersion).toBe(0)
	})

	it('set() persists values', () => {
		settings.set({ theme: 'dark', terminalScrollback: 5000 })
		const s = settings.get()
		expect(s.theme).toBe('dark')
		expect(s.terminalScrollback).toBe(5000)
	})

	it('set() serializes booleans as string true/false', () => {
		settings.set({ defaultWorktreeEnabled: false })
		const row = db.prepare("SELECT value FROM settings WHERE key = 'defaultWorktreeEnabled'").get() as any
		expect(row.value).toBe('false')
	})

	it('set() serializes objects as JSON', () => {
		const mappings = { todo: 'label:todo', planning: 'label:planning' }
		settings.set({ statusLabelMappings: mappings })
		const row = db.prepare("SELECT value FROM settings WHERE key = 'statusLabelMappings'").get() as any
		expect(JSON.parse(row.value)).toEqual(mappings)
	})

	it('round-trip: set then get returns correct types', () => {
		settings.set({
			theme: 'light',
			defaultWorktreeEnabled: false,
			terminalScrollback: 20000,
			githubPollingEnabled: true,
			githubPollingIntervalMs: 60000,
			githubBotUsername: 'bot',
			autoPickupEnabled: true,
			onboardingVersion: 3,
		})
		const s = settings.get()
		expect(s.theme).toBe('light')
		expect(s.defaultWorktreeEnabled).toBe(false)
		expect(typeof s.defaultWorktreeEnabled).toBe('boolean')
		expect(s.terminalScrollback).toBe(20000)
		expect(typeof s.terminalScrollback).toBe('number')
		expect(s.githubPollingEnabled).toBe(true)
		expect(typeof s.githubPollingEnabled).toBe('boolean')
		expect(s.githubPollingIntervalMs).toBe(60000)
		expect(typeof s.githubPollingIntervalMs).toBe('number')
		expect(s.githubBotUsername).toBe('bot')
		expect(s.autoPickupEnabled).toBe(true)
		expect(s.onboardingVersion).toBe(3)
		expect(typeof s.onboardingVersion).toBe('number')
	})
})
