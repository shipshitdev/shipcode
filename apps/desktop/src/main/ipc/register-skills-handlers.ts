import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SKILLS,
  inspectProjectSetup,
  isRepoSkillBundleKey,
  loadRepoContext,
  PHASE_SKILL_KEYS,
  rewriteSkillDraft,
  seedRepoSkillBundle,
  validateSkill,
} from '@shipcode/agents';
import {
  clampError,
  clampTextBlock,
  type PhaseSkillKey,
  type Project,
  type RepoSkillBundleKey,
} from '@shipcode/shared';
import { shell } from 'electron';
import log from '../logger.service';
import { assertPrdRewriteModelSupported, buildSkillRow, resolvePrdRewriteContext } from './helpers';
import type { IpcHandlerDeps } from './types';

function getWritingPrdsPaths(projectPath: string) {
  const skillDir = path.join(projectPath, 'skills', 'writing-prds');
  const skillPath = path.join(skillDir, 'SKILL.md');
  const exists = fs.existsSync(skillPath);

  return {
    absolutePath: skillPath,
    exists,
    openTargetPath: exists ? skillPath : fs.existsSync(skillDir) ? skillDir : projectPath,
  };
}

function formatStatusMapping(project: Project): string {
  const mapping = project.githubStatusMapping;
  if (!mapping) return 'GitHub Projects status mapping: not configured';

  const parts = [
    ['todo', mapping.todo],
    ['in_progress', mapping.inProgress],
    ['human_review', mapping.humanReview],
    ['done', mapping.done],
  ] as const;

  return `GitHub Projects status mapping: ${parts
    .map(([key, option]) => `${key}=${option?.name ?? 'unmapped'}`)
    .join(', ')}`;
}

function buildSkillRewriteProjectContext(project: Project | null): string {
  if (!project) {
    return 'No active project selected. Rewrite for the selected scope without repo-specific assumptions.';
  }

  const lines = [
    `Project: ${project.name}`,
    `Path: ${project.path}`,
    `Git remote: ${project.gitRemote ?? 'not configured'}`,
    `GitHub repo: ${project.githubRepoFullName ?? 'not configured'}`,
    `GitHub project board: ${project.githubProjectUrl ?? 'not configured'}`,
    formatStatusMapping(project),
  ];

  try {
    const setup = inspectProjectSetup(project.path);
    lines.push(`Setup status: ${setup.status}`);
    if (setup.error) lines.push(`Setup error: ${setup.error}`);
    if (setup.contract) {
      lines.push(
        `Setup commands: ${
          setup.contract.setupCommands.length > 0
            ? setup.contract.setupCommands.join(' && ')
            : 'none'
        }`,
      );
      lines.push(
        `Verification commands: ${
          setup.contract.verifyCommands.length > 0
            ? setup.contract.verifyCommands.join(' && ')
            : 'none'
        }`,
      );
      if (setup.contract.testingContext) {
        lines.push(`Testing context: ${setup.contract.testingContext}`);
      }
    }
  } catch (err) {
    lines.push(`Setup inspection failed: ${clampError(err)}`);
  }

  try {
    lines.push(`Repo memory:\n${clampTextBlock(loadRepoContext(project.path), 10_000)}`);
  } catch (err) {
    lines.push(`Repo memory unavailable: ${clampError(err)}`);
  }

  return lines.join('\n');
}

export function registerSkillsHandlers({ ipcMain, queries }: IpcHandlerDeps): void {
  ipcMain.handle('skills:list-for-view', (_event, { projectId }: { projectId: string | null }) => {
    return PHASE_SKILL_KEYS.map((phase) => {
      const projectRow = projectId !== null ? buildSkillRow(queries, phase, projectId) : null;
      const globalRow = buildSkillRow(queries, phase, null);
      return {
        phase,
        requiredSlots: DEFAULT_SKILLS[phase].requiredSlots,
        bundledVersion: DEFAULT_SKILLS[phase].version,
        bundledSchemaVersion: DEFAULT_SKILLS[phase].schemaVersion,
        projectRow,
        globalRow,
        active:
          projectRow && projectRow.source !== 'default' && projectRow.status === 'ok'
            ? projectRow
            : globalRow,
      };
    });
  });

  ipcMain.handle(
    'skills:read',
    (_event, { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey }) => {
      return buildSkillRow(queries, phase, projectId);
    },
  );

  ipcMain.handle(
    'skills:write',
    (
      _event,
      {
        projectId,
        phase,
        content,
      }: { projectId: string | null; phase: PhaseSkillKey; content: string },
    ) => {
      const error = validateSkill(phase, content);
      if (error) {
        return { ok: false as const, error };
      }
      const bundled = DEFAULT_SKILLS[phase];
      queries.skills.set(projectId, phase, content, bundled.version, bundled.schemaVersion);
      return { ok: true as const, row: buildSkillRow(queries, phase, projectId) };
    },
  );

  ipcMain.handle(
    'skills:reset',
    (_event, { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey }) => {
      queries.skills.delete(projectId, phase);
      return buildSkillRow(queries, phase, projectId);
    },
  );

  ipcMain.handle(
    'skills:rewrite',
    async (
      _event,
      {
        projectId,
        contextProjectId,
        phase,
        content,
        instruction,
      }: {
        projectId: string | null;
        contextProjectId?: string | null;
        phase: PhaseSkillKey;
        content: string;
        instruction: string;
      },
    ) => {
      const trimmedInstruction = instruction.trim();
      if (!trimmedInstruction) throw new Error('Rewrite instructions are required');

      const bundled = DEFAULT_SKILLS[phase];
      if (!bundled) throw new Error(`Unknown skill phase: ${phase}`);

      const effectiveContextProjectId = contextProjectId ?? projectId;
      const contextProject =
        effectiveContextProjectId !== null
          ? queries.projects.getById(effectiveContextProjectId)
          : null;
      if (effectiveContextProjectId !== null && !contextProject) {
        throw new Error(`Project ${effectiveContextProjectId} not found`);
      }

      const rewriteContext = resolvePrdRewriteContext(queries.settings.get());

      await assertPrdRewriteModelSupported(
        rewriteContext.cli,
        rewriteContext.modelId,
        rewriteContext.reasoningEffort,
      );

      try {
        return await rewriteSkillDraft({
          phase,
          currentContent: content,
          bundledContent: bundled.content,
          requiredSlots: bundled.requiredSlots,
          userInstruction: trimmedInstruction,
          projectContext: buildSkillRewriteProjectContext(contextProject),
          cwd: contextProject?.path ?? process.cwd(),
          ...rewriteContext,
        });
      } catch (err) {
        log.error('[skills:rewrite]', err);
        throw new Error(clampError(err));
      }
    },
  );

  ipcMain.handle('skills:get-writing-prds-info', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const paths = getWritingPrdsPaths(project.path);
    return {
      projectId,
      projectPath: project.path,
      absolutePath: paths.absolutePath,
      exists: paths.exists,
      usingFallback: !paths.exists,
      openTargetPath: paths.openTargetPath,
    };
  });

  ipcMain.handle(
    'skills:open-writing-prds',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const { openTargetPath } = getWritingPrdsPaths(project.path);
      const openError = await shell.openPath(openTargetPath);
      if (openError) throw new Error(openError);
    },
  );

  ipcMain.handle(
    'skills:seed-repo-bundle',
    (
      _event,
      {
        projectId,
        bundle = 'dev-loop',
        force = false,
      }: { projectId: string; bundle?: RepoSkillBundleKey; force?: boolean },
    ) => {
      try {
        const project = queries.projects.getById(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        if (!isRepoSkillBundleKey(bundle)) {
          throw new Error(`Unknown repo skill bundle: ${bundle}`);
        }

        const result = seedRepoSkillBundle({
          bundle,
          cwd: project.path,
          force,
        });

        return {
          bundle: result.bundle,
          targetDir: result.targetDir,
          files: result.files.map(({ path: filePath, status }) => ({ path: filePath, status })),
        };
      } catch (err) {
        log.error('[skills:seed-repo-bundle]', err);
        throw new Error(clampError(err));
      }
    },
  );
}
