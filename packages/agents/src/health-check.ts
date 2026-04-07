import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { CliHealth, SystemHealth } from '@crosscode/shared'

const execAsync = promisify(exec)

async function checkCli(command: string, versionFlag: string = '--version'): Promise<CliHealth> {
  try {
    // First check if binary exists
    const whichResult = await execAsync(`which ${command}`)
    const binaryPath = whichResult.stdout.trim()

    if (!binaryPath) {
      return { available: false, version: null, path: null, error: `${command} not found in PATH` }
    }

    // Then check version
    try {
      const versionResult = await execAsync(`${command} ${versionFlag}`)
      const version = versionResult.stdout.trim() || versionResult.stderr.trim()
      return { available: true, version, path: binaryPath, error: null }
    } catch {
      // Binary exists but version check failed — still usable
      return { available: true, version: null, path: binaryPath, error: null }
    }
  } catch {
    return { available: false, version: null, path: null, error: `${command} not found in PATH` }
  }
}

export async function checkSystemHealth(): Promise<SystemHealth> {
  const [claude, codex, git, gh] = await Promise.all([
    checkCli('claude', '--version'),
    checkCli('codex', '--version'),
    checkCli('git', '--version'),
    checkCli('gh', '--version'),
  ])

  return { claude, codex, git, gh }
}

export async function checkClaudeAuth(): Promise<boolean> {
  try {
    // Quick check if Claude is authenticated by running a minimal command
    const result = await execAsync('claude -p "respond with OK" --max-turns 1 --output-format json', {
      timeout: 30_000,
    })
    return result.stdout.includes('OK')
  } catch {
    return false
  }
}
