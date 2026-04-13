import { DEFAULT_SKILLS, PHASE_SKILL_KEYS, validateSkill } from '@shipcode/agents';
import type { PhaseSkillKey } from '@shipcode/shared';
import { buildSkillRow } from './helpers';
import type { IpcHandlerDeps } from './types';

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
}
