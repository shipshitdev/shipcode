import path from 'node:path'
import fs from 'node:fs'
import { createInterface } from 'node:readline'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getDatabase, SettingsQueries } from '@shipcode/db'
import { checkSystemHealthWithAuth, checkGhAuth } from '@shipcode/agents'
import { CURRENT_ONBOARDING_VERSION, DEFAULT_STATUS_LABEL_MAPPINGS } from '@shipcode/shared'
import type { AgentType, AppSettings } from '@shipcode/shared'

const execAsync = promisify(exec)

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

export async function setupCommand(opts: { force?: boolean }) {
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data')

  // Check if already onboarded (unless --force)
  if (!opts.force && fs.existsSync(path.join(dataDir, 'shipcode.db'))) {
    try {
      const db = getDatabase(dataDir)
      const settings = new SettingsQueries(db)
      const current = settings.get()
      if (current.onboardingVersion >= CURRENT_ONBOARDING_VERSION) {
        console.log('Setup already completed. Use --force to re-run.')
        return
      }
    } catch {
      // DB exists but can't read — proceed with setup
    }
  }

  console.log('\n  ShipCode Setup\n')
  console.log('  Checking CLI tools...\n')

  // Step 1: Auth check
  const [health, ghAuth] = await Promise.all([
    checkSystemHealthWithAuth(),
    checkGhAuth(),
  ])

  const rows = [
    { tool: 'Claude CLI', installed: health.claude.available, auth: health.claude.authenticated, version: health.claude.version },
    { tool: 'Codex CLI', installed: health.codex.available, auth: health.codex.authenticated, version: health.codex.version },
    { tool: 'GitHub CLI', installed: ghAuth.installed, auth: ghAuth.authenticated, version: health.gh.version },
    { tool: 'Git', installed: health.git.available, auth: true, version: health.git.version },
  ]

  for (const row of rows) {
    const status = !row.installed
      ? '\x1b[31m✗ not installed\x1b[0m'
      : row.auth
        ? `\x1b[32m✓ authenticated\x1b[0m`
        : '\x1b[33m! not authenticated\x1b[0m'
    console.log(`  ${row.tool.padEnd(14)} ${status}`)
  }

  const aiAuthCount = [health.claude.authenticated, health.codex.authenticated].filter(Boolean).length

  if (aiAuthCount === 0) {
    console.log('\n  \x1b[31mNo AI CLIs authenticated.\x1b[0m Run:')
    console.log('    claude login')
    console.log('    codex login')
    console.log('\n  Then re-run: shipcode setup')
    return
  }

  if (aiAuthCount === 1) {
    console.log('\n  \x1b[33mOnly one AI CLI authenticated.\x1b[0m')
    console.log('  Adversarial review will be skipped (single-agent mode).')
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    // Step 2: GitHub repo
    let selectedRepo: string | null = null
    if (ghAuth.authenticated) {
      try {
        const result = await execAsync("gh repo view --json nameWithOwner --jq '.nameWithOwner'", { timeout: 10_000 })
        const detected = result.stdout.trim()
        if (detected) {
          const answer = await ask(rl, `\n  Use repo ${detected}? [Y/n] `)
          if (answer.toLowerCase() !== 'n') {
            selectedRepo = detected
          }
        }
      } catch {
        console.log('\n  Could not auto-detect repo from current directory.')
      }
    }

    // Step 3: Model preferences
    let plannerModel: AgentType = 'claude'
    let reviewerModel: AgentType = 'codex'

    if (aiAuthCount >= 2) {
      const plannerAnswer = await ask(rl, `\n  Planner model [claude/codex] (default: claude): `)
      if (plannerAnswer === 'codex') plannerModel = 'codex'

      const reviewerAnswer = await ask(rl, `  Reviewer model [claude/codex] (default: codex): `)
      if (reviewerAnswer === 'claude') reviewerModel = 'claude'
    } else {
      // Single agent: use whichever is authenticated
      const available = health.claude.authenticated ? 'claude' : 'codex'
      plannerModel = available as AgentType
      reviewerModel = available as AgentType
      console.log(`\n  Single-agent mode: using ${available} for both planning and execution.`)
    }

    // Step 4: Save settings
    fs.mkdirSync(dataDir, { recursive: true })
    const db = getDatabase(dataDir)
    const settings = new SettingsQueries(db)

    const patch: Partial<AppSettings> = {
      plannerModel,
      reviewerModel,
      githubPollingEnabled: selectedRepo !== null,
      statusLabelMappings: DEFAULT_STATUS_LABEL_MAPPINGS,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    }

    settings.set(patch)
    console.log('\n  \x1b[32mSetup complete!\x1b[0m')
    console.log('  Run `shipcode status` to check your pipeline.\n')
  } finally {
    rl.close()
  }
}
