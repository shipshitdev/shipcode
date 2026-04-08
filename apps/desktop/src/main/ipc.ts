import { type IpcMain, type BrowserWindow, dialog } from 'electron'
import type { ProjectQueries, ThreadQueries, PlanQueries, ReviewQueries, DiffQueries, SettingsQueries, VerificationQueries, GitHubIssueQueries } from '@shipcode/db'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProcessManager } from '@shipcode/agents'
import { checkSystemHealthWithAuth, checkGhAuth, GhCli } from '@shipcode/agents'

const execAsync = promisify(exec)
import { GitService, WorktreeManager } from '@shipcode/git'
import type { Pipeline } from '@shipcode/pipeline'

interface Queries {
  projects: ProjectQueries
  threads: ThreadQueries
  plans: PlanQueries
  reviews: ReviewQueries
  diffs: DiffQueries
  settings: SettingsQueries
  verifications: VerificationQueries
  githubIssues: GitHubIssueQueries
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  processManager: ProcessManager,
  pipeline: Pipeline
): void {
  // === Project handlers ===
  ipcMain.handle('project:list', () => {
    return queries.projects.list()
  })

  ipcMain.handle('project:add', async (_event, { path: projectPath }: { path: string }) => {
    const project = queries.projects.add(projectPath)

    // Detect git info
    try {
      const git = new GitService(projectPath)
      const remote = await git.getRemoteUrl()
      const branch = await git.getDefaultBranch()
      queries.projects.updateGitInfo(project.id, remote, branch)
      return { ...project, gitRemote: remote, defaultBranch: branch }
    } catch {
      return project
    }
  })

  ipcMain.handle('project:remove', (_event, { projectId }: { projectId: string }) => {
    queries.projects.remove(projectId)
  })

  // === Thread handlers ===
  ipcMain.handle('thread:list', (_event, { projectId }: { projectId: string }) => {
    return queries.threads.list(projectId)
  })

  ipcMain.handle('thread:create', (_event, { projectId, prompt, useWorktree }: { projectId: string; prompt: string; useWorktree: boolean }) => {
    const title = prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt
    return queries.threads.create(projectId, prompt, title)
  })

  ipcMain.handle('thread:get', (_event, { threadId }: { threadId: string }) => {
    return queries.threads.getById(threadId)
  })

  // === Plan handlers ===
  ipcMain.handle('plan:get', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.getLatest(threadId)
  })

  ipcMain.handle('plan:list', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.list(threadId)
  })

  ipcMain.handle('plan:update', (_event, { planId, structured }: { planId: string; structured: any }) => {
    queries.plans.updateStructured(planId, structured)
  })

  // === Review handlers ===
  ipcMain.handle('review:get', (_event, { planId }: { planId: string }) => {
    return queries.reviews.getByPlanId(planId)
  })

  ipcMain.handle('review:list-by-plans', (_event, { planIds }: { planIds: string[] }) => {
    return queries.reviews.listByPlanIds(planIds)
  })

  // === Diff handlers ===
  ipcMain.handle('diff:list', (_event, { threadId }: { threadId: string }) => {
    return queries.diffs.list(threadId)
  })

  // === Git handlers ===
  ipcMain.handle('git:status', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const git = new GitService(project.path)
    return git.getStatus()
  })

  ipcMain.handle('git:commit', async (_event, { projectId, message }: { projectId: string; message: string }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const git = new GitService(project.path)
    return git.commit(message)
  })

  ipcMain.handle('git:push', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)
    const git = new GitService(project.path)
    return git.push()
  })

  // === Settings handlers ===
  ipcMain.handle('settings:get', () => {
    return queries.settings.get()
  })

  ipcMain.handle('settings:set', (_event, patch: any) => {
    queries.settings.set(patch)
  })

  // === Health check ===
  ipcMain.handle('health:check', async () => {
    return checkSystemHealthWithAuth()
  })

  // === Dialog handlers ===
  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  // === GitHub handlers ===
  ipcMain.handle('github:get-issue', (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
    return queries.githubIssues.getByNumber(projectId, issueNumber)
  })

  ipcMain.handle('github:list-issues', (_event, { projectId }: { projectId: string }) => {
    return queries.githubIssues.list(projectId)
  })

  ipcMain.handle('github:refresh-issues', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const ghCli = new GhCli(project.path)
    const issues = await ghCli.listAllIssues()

    // Upsert all issues into cache
    for (const issue of issues) {
      queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      })
    }

    const cached = queries.githubIssues.list(projectId)
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached })
    return cached
  })

  ipcMain.handle('github:create-issue', async (_event, { projectId, title, body, labels }: { projectId: string; title: string; body?: string; labels?: string[] }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const ghCli = new GhCli(project.path)
    const issue = await ghCli.createIssue({ title, body, labels })

    // Cache the new issue in the database
    queries.githubIssues.upsert({
      projectId,
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      assignee: issue.assignee,
      state: issue.state,
    })

    // Notify renderer that issues changed
    const allIssues = queries.githubIssues.list(projectId)
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues })

    return queries.githubIssues.getByNumber(projectId, issue.number)
  })

  ipcMain.handle('github:start-issue', async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
    const project = queries.projects.getById(projectId)
    if (!project) throw new Error(`Project ${projectId} not found`)

    const issue = queries.githubIssues.getByNumber(projectId, issueNumber)
    if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`)

    // Idempotency: reject if issue already has an active thread
    if (issue.threadId) {
      const thread = queries.threads.getById(issue.threadId)
      if (thread && !['failed', 'completed'].includes(thread.status)) {
        throw new Error(`Issue #${issueNumber} already has active thread`)
      }
    }

    // Update status and create thread (single source of thread creation)
    queries.githubIssues.updatePipelineStatus(issue.id, 'planning')
    const thread = queries.threads.create(projectId, issue.body ?? issue.title, issue.title)
    queries.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote)
    queries.githubIssues.linkThread(issue.id, thread.id)
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: queries.githubIssues.list(projectId) })

    // Start pipeline — pass existing threadId, not projectId
    try {
      await pipeline.startFromGitHubIssue(
        thread.id,
        project.path,
        { number: issue.issueNumber, title: issue.title, body: issue.body, labels: issue.labels },
        'claude'
      )
    } catch (err) {
      // Rollback
      queries.githubIssues.updatePipelineStatus(issue.id, 'todo')
      queries.threads.updateStatus(thread.id, 'failed')
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: queries.githubIssues.list(projectId) })
      throw err
    }
  })

  ipcMain.handle('github:retry-issue', (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
    const issue = queries.githubIssues.getByNumber(projectId, issueNumber)
    if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`)

    queries.githubIssues.updatePipelineStatus(issue.id, 'todo')
    const allIssues = queries.githubIssues.list(projectId)
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues })
  })

  // === Verification handlers ===
  ipcMain.handle('verification:get', (_event, { threadId }: { threadId: string }) => {
    return queries.verifications.getLatest(threadId)
  })

  // === Pipeline handlers (wired to actual pipeline) ===
  ipcMain.handle('pipeline:start', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId)
    if (!thread) throw new Error(`Thread ${threadId} not found`)

    const project = queries.projects.getById(thread.projectId)
    if (!project) throw new Error(`Project ${thread.projectId} not found`)

    // Optionally set up worktree
    let worktreePath: string | null = null
    try {
      const worktreeManager = new WorktreeManager(project.path)
      const wt = await worktreeManager.create(threadId, project.defaultBranch)
      worktreePath = wt.worktreePath
      queries.threads.setWorktree(threadId, wt.branch, wt.worktreePath)
    } catch (err) {
      // Worktree creation failed — run in project root instead
      console.error('Worktree creation failed, running in project root:', err)
    }

    pipeline.initializeContext(threadId, {
      projectPath: project.path,
      worktreePath,
    })

    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, worktreePath)
  })

  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    const latestPlan = queries.plans.getLatest(threadId)
    if (latestPlan?.structured) {
      queries.plans.updateStatus(latestPlan.id, 'approved')
      await pipeline.startExecution(threadId, latestPlan.structured)
    } else {
      // No structured plan — just mark as executing anyway
      mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'failed' })
    }
  })

  ipcMain.handle('pipeline:reject', async (_event, { threadId, feedback }: { threadId: string; feedback: string }) => {
    const thread = queries.threads.getById(threadId)
    if (!thread) return

    const project = queries.projects.getById(thread.projectId)
    if (!project) return

    // Supersede old plans and restart planning with feedback
    queries.plans.supersedeAll(threadId)
    const revisedPrompt = `${thread.prompt}\n\nFeedback from review:\n${feedback}`
    await pipeline.startPlanGeneration(threadId, revisedPrompt, project.path, thread.worktreePath)
  })

  ipcMain.handle('pipeline:cancel', (_event, { threadId }: { threadId: string }) => {
    pipeline.cancel(threadId)
  })

  ipcMain.handle('pipeline:skip-review', async (_event, { threadId }: { threadId: string }) => {
    queries.threads.updateStatus(threadId, 'awaiting_approval')
    mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'awaiting_approval' })
  })

  // === Onboarding handlers ===
  ipcMain.handle('onboarding:check-auth', async () => {
    const [health, ghAuth] = await Promise.all([
      checkSystemHealthWithAuth(),
      checkGhAuth(),
    ])
    return { ...health, ghAuth }
  })

  ipcMain.handle('onboarding:list-repos', async () => {
    try {
      const { stdout } = await execAsync(
        "gh api 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member' --paginate --jq '.[].full_name'",
        { timeout: 20_000 },
      )

      return [...new Set(stdout.trim().split('\n').filter(Boolean))].sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  // === Agent output forwarding to renderer ===
  processManager.on('output', (processId: string, data: string) => {
    mainWindow.webContents.send('agent:output', { processId, chunk: data })
  })

  processManager.on('stateChange', (processId: string, type: string, state: string) => {
    mainWindow.webContents.send('agent:state', { processId, type, state })
  })
}
