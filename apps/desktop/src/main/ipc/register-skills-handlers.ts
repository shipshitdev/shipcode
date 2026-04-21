import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SKILLS, PHASE_SKILL_KEYS, validateSkill } from '@shipcode/agents';
import type { PhaseSkillKey } from '@shipcode/shared';
import { shell } from 'electron';
import { buildSkillRow } from './helpers';
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

  ipcMain.handle('skills:list-quarantined', () => {
    return queries.skills.listQuarantined().map((row) => ({
      phase: row.phase,
      projectId: row.projectId,
      statusReason: row.statusReason,
      updatedAt: row.updatedAt,
    }));
  });

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
}
