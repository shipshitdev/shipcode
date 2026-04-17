import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main';
import type { ProjectQueries, SettingsQueries } from '@shipcode/db';
import fs from 'node:fs';
import path from 'node:path';
import { clampError } from '@shipcode/shared';
import { enhancePrdDraft } from '@shipcode/agents';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  getPrdAttachmentSessionSummary,
  removePrdAttachment,
  stagePrdAttachments,
} from './prd-attachments';

interface SupportQueries {
  projects: ProjectQueries;
  settings: SettingsQueries;
}

function getSenderId(event: IpcMainInvokeEvent): number {
  return event.sender.id;
}

function loadWritingPrdSkill(projectPath: string): string {
  const skillPath = path.join(projectPath, '.agents', 'skills', 'writing-prds', 'SKILL.md');
  try {
    return fs.readFileSync(skillPath, 'utf-8');
  } catch {
    return (
      "You are drafting a PRD that will be consumed by the ShipCode pipeline's planner agent. " +
      'The PRD lives in a GitHub issue body. Required sections: Executive Summary, Problem Statement, ' +
      'Goals, Non-Goals, User Stories, Functional Requirements, Non-Functional Requirements, ' +
      'Success Criteria, Out of Scope, Dependencies, Verification Plan, Risks & Open Questions.'
    );
  }
}

export function registerSupportHandlers(ipcMain: IpcMain, queries: SupportQueries): void {
  ipcMain.handle(
    'prd-attachments:create-session',
    (event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return createPrdAttachmentSession({
        senderId: getSenderId(event),
        projectId,
      });
    },
  );

  ipcMain.handle(
    'prd-attachments:stage',
    async (
      event,
      {
        projectId,
        attachmentSessionId,
        paths,
      }: { projectId: string; attachmentSessionId: string; paths: string[] },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return stagePrdAttachments({
        senderId: getSenderId(event),
        projectId,
        attachmentSessionId,
        paths,
      });
    },
  );

  ipcMain.handle(
    'prd-attachments:remove',
    async (
      event,
      {
        projectId,
        attachmentSessionId,
        attachmentId,
      }: { projectId: string; attachmentSessionId: string; attachmentId: string },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return removePrdAttachment({
        senderId: getSenderId(event),
        projectId,
        attachmentSessionId,
        attachmentId,
      });
    },
  );

  ipcMain.handle(
    'prd-attachments:clear',
    async (event, { projectId, attachmentSessionId }: { projectId: string; attachmentSessionId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      await clearPrdAttachmentSession({
        senderId: getSenderId(event),
        projectId,
        attachmentSessionId,
      });
    },
  );

  ipcMain.handle(
    'ai:enhance-prd',
    async (
      event,
      {
        projectId,
        draftBody,
        attachmentSessionId,
      }: {
        projectId: string;
        draftBody: string;
        attachmentSessionId: string | null;
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      if (attachmentSessionId) {
        const session = getPrdAttachmentSessionSummary({
          senderId: getSenderId(event),
          projectId,
          attachmentSessionId,
        });
        if (!session) {
          throw new Error('Attachment session not found.');
        }
        if (session.attachments.length > 0) {
          throw new Error('Write PRD does not support attachments yet.');
        }
      }

      const skillContent = loadWritingPrdSkill(project.path);
      const settings = queries.settings.get();
      const plannerModel: 'claude' | 'codex' =
        settings.plannerModel === 'codex' ? 'codex' : 'claude';

      try {
        return await enhancePrdDraft({
          draftBody: draftBody ?? '',
          skillContent,
          plannerModel,
          cwd: project.path,
        });
      } catch (err) {
        log.error('[ai:enhance-prd]', err);
        throw new Error(clampError(err, 300));
      }
    },
  );
}
