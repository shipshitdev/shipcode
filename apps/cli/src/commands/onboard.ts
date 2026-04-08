import path from 'node:path'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getDatabase, ProjectQueries } from '@shipcode/db'
import { checkSystemHealth, checkClaudeAuth } from '@shipcode/agents'
import { GitService } from '@shipcode/git'
import { DEFAULT_STATUS_LABEL_MAPPINGS } from '@shipcode/shared'

const execAsync = promisify(exec)

export async function onboardCommand() {
	const cwd = process.cwd()
	console.log('ShipCode Onboarding\n')

	// 1. Prerequisite validation
	console.log('Checking prerequisites...')
	const health = await checkSystemHealth()

	const failures: string[] = []
	if (!health.git.available) failures.push('git is not installed')
	if (!health.gh.available) failures.push('gh (GitHub CLI) is not installed')
	if (!health.claude.available) failures.push('claude CLI is not installed')
	if (!health.codex.available) failures.push('codex CLI is not installed')

	if (failures.length > 0) {
		console.error('\n✗ Missing prerequisites:')
		for (const f of failures) console.error(`  - ${f}`)
		process.exit(1)
	}

	console.log('  ✓ git, gh, claude, codex — all available')

	// Auth checks
	try {
		await execAsync('gh auth status', { timeout: 10_000 })
		console.log('  ✓ gh — authenticated')
	} catch {
		console.error('\n✗ gh is not authenticated. Run: gh auth login')
		process.exit(1)
	}

	const claudeAuth = await checkClaudeAuth()
	if (claudeAuth) {
		console.log('  ✓ claude — authenticated')
	} else {
		console.error('\n✗ claude is not authenticated. Check your API key or run: claude auth')
		process.exit(1)
	}

	console.log('  ⚠ codex — auth not verifiable (ensure API key is configured)')

	// 2. Repo context verification
	console.log('\nVerifying GitHub repository...')
	try {
		await execAsync('git rev-parse --is-inside-work-tree', { cwd, timeout: 5_000 })
	} catch {
		console.error('✗ Not inside a git repository')
		process.exit(1)
	}

	let repoSlug: string
	try {
		const { stdout } = await execAsync('gh repo view --json nameWithOwner -q .nameWithOwner', {
			cwd,
			timeout: 10_000,
		})
		repoSlug = stdout.trim()
		console.log(`  ✓ GitHub repo: ${repoSlug}`)
	} catch {
		console.error('✗ Not a GitHub repository or gh cannot resolve repo context')
		process.exit(1)
	}

	// 3. Database bootstrap
	const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data')
	fs.mkdirSync(dataDir, { recursive: true })
	const db = getDatabase(dataDir)
	const projects = new ProjectQueries(db)

	// 4. Git info detection
	const gitService = new GitService(cwd)
	const gitRemote = await gitService.getRemoteUrl()
	const defaultBranch = await gitService.getDefaultBranch()
	console.log(`  ✓ Remote: ${gitRemote ?? 'none'}`)
	console.log(`  ✓ Default branch: ${defaultBranch}`)

	// 5. Project registration
	let project = projects.list().find((p) => p.path === cwd)
	if (!project) {
		project = projects.add(cwd)
		console.log('\n  ✓ Project registered')
	} else {
		console.log('\n  ✓ Project already registered')
	}
	projects.updateGitInfo(project.id, gitRemote, defaultBranch)

	// 6. Label verification
	console.log('\nChecking GitHub labels...')
	const expectedLabels = [...new Set(Object.values(DEFAULT_STATUS_LABEL_MAPPINGS).filter(Boolean))]
	try {
		const { stdout } = await execAsync('gh label list --json name -q ".[].name"', {
			cwd,
			timeout: 10_000,
		})
		const existingLabels = stdout.trim().split('\n').filter(Boolean)
		const missing = expectedLabels.filter((l) => !existingLabels.includes(l))
		if (missing.length > 0) {
			console.log(`  ⚠ Missing labels: ${missing.join(', ')}`)
			console.log('    Create them manually or they will be skipped during pipeline runs')
		} else {
			console.log('  ✓ All status labels present')
		}
	} catch {
		console.log('  ⚠ Could not check labels')
	}

	// 7. Summary
	console.log('\n─────────────────────────────')
	console.log('ShipCode is ready!')
	console.log(`  Repo:     ${repoSlug}`)
	console.log(`  Remote:   ${gitRemote ?? 'none'}`)
	console.log(`  Branch:   ${defaultBranch}`)
	console.log(`  Data:     ${dataDir}`)
	console.log('\nNext step:')
	console.log('  shipcode run <issue-number>')
	console.log('─────────────────────────────\n')
}
