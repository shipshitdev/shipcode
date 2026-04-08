import { exec } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CliHealth, GhAuthStatus, SystemHealth } from '@shipcode/shared'

const execAsync = promisify(exec)

async function checkCli(command: string, versionFlag: string = '--version'): Promise<CliHealth> {
  try {
    const whichResult = await execAsync(`which ${command}`)
    const binaryPath = whichResult.stdout.trim()

    if (!binaryPath) {
      return { available: false, version: null, path: null, error: `${command} not found in PATH`, authenticated: false }
    }

    try {
      const versionResult = await execAsync(`${command} ${versionFlag}`)
      const version = versionResult.stdout.trim() || versionResult.stderr.trim()
      return { available: true, version, path: binaryPath, error: null, authenticated: false }
    } catch {
      return { available: true, version: null, path: binaryPath, error: null, authenticated: false }
    }
  } catch {
    return { available: false, version: null, path: null, error: `${command} not found in PATH`, authenticated: false }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function checkClaudeAuth(): Promise<boolean> {
  try {
    // Try `claude auth status` first (supported in newer CLI versions)
    // execAsync resolves on exit code 0, so reaching here means authenticated
    await execAsync('claude auth status', { timeout: 10_000 })
    return true
  } catch {
    // Command may not exist in older versions — fall back to credential file check
  }

  // Fall back to checking for credential files
  const credentialPath = join(homedir(), '.claude', '.credentials.json')
  return fileExists(credentialPath)
}

export async function checkCodexAuth(): Promise<boolean> {
  // Check for OPENAI_API_KEY via shell spawn (Electron Dock launch doesn't inherit shell env)
  try {
    const result = await execAsync('printenv OPENAI_API_KEY', { timeout: 5_000 })
    if (result.stdout.trim()) {
      return true
    }
  } catch {
    // Env var not set — try config file
  }

  // Check for Codex auth config file
  const codexAuthPath = join(homedir(), '.codex', 'auth.json')
  return fileExists(codexAuthPath)
}

export async function checkGhAuth(): Promise<GhAuthStatus> {
  try {
    const result = await execAsync('gh auth status 2>&1', { timeout: 10_000 })
    const output = result.stdout + result.stderr
    const usernameMatch = output.match(/Logged in to github\.com.*account\s+(\S+)/)
    return {
      installed: true,
      authenticated: true,
      username: usernameMatch?.[1] ?? null,
      error: null,
    }
  } catch (err) {
    // Check if gh is installed but not authenticated
    try {
      await execAsync('which gh')
      return {
        installed: true,
        authenticated: false,
        username: null,
        error: err instanceof Error ? err.message : 'gh auth check failed',
      }
    } catch {
      return {
        installed: false,
        authenticated: false,
        username: null,
        error: 'gh not found in PATH',
      }
    }
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

export async function checkSystemHealthWithAuth(): Promise<SystemHealth> {
  const [health, claudeAuth, codexAuth] = await Promise.all([
    checkSystemHealth(),
    checkClaudeAuth(),
    checkCodexAuth(),
  ])

  return {
    ...health,
    claude: { ...health.claude, authenticated: health.claude.available && claudeAuth },
    codex: { ...health.codex, authenticated: health.codex.available && codexAuth },
  }
}
