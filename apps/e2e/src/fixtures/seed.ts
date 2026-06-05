import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeDatabase,
  GitHubIssueQueries,
  getDatabase,
  NotificationsQueries,
  ProjectQueries,
  SettingsQueries,
} from '@shipcode/db';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';

export interface SeedIssue {
  issueNumber: number;
  title: string;
  body?: string;
  labels?: string[];
  assignee?: string | null;
  author?: string | null;
  state?: 'open' | 'closed';
  updatedAt?: string | null;
}

export interface SeedOptions {
  /** When false, leaves onboardingVersion at 0 so the OnboardingWizard renders. Default true. */
  onboarded?: boolean;
  /** Issues to pre-cache for the seeded project (drives the board without network). */
  issues?: SeedIssue[];
  /** Optional notifications to pre-seed for the inbox flow. */
  notifications?: Array<{ kind: string; title: string; threadId?: string | null }>;
}

export interface SeedResult {
  projectId: string;
  projectPath: string;
  issues: SeedIssue[];
}

/**
 * Seed a fresh ShipCode SQLite database at `dataDir` for an E2E run.
 *
 * Opens the real app database (running every migration), inserts a project
 * pointed at a real temp directory (so workflow-file watchers don't choke),
 * sets the onboarding gate, and optionally pre-caches issues + notifications.
 * Closes the handle before returning so the Electron main process can open the
 * same file cleanly on launch.
 */
export function seedDatabase(dataDir: string, options: SeedOptions = {}): SeedResult {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = getDatabase(dataDir);
  try {
    new SettingsQueries(db).set({
      onboardingVersion: options.onboarded === false ? 0 : CURRENT_ONBOARDING_VERSION,
    });

    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-e2e-proj-'));
    const project = new ProjectQueries(db).add(projectPath, {
      githubRepoFullName: 'shipshitdev/shipcode-e2e',
    });

    const issues = options.issues ?? [];
    if (issues.length > 0) {
      const issueQueries = new GitHubIssueQueries(db);
      for (const issue of issues) {
        issueQueries.upsert({
          projectId: project.id,
          issueNumber: issue.issueNumber,
          title: issue.title,
          body: issue.body ?? '',
          labels: issue.labels ?? [],
          assignee: issue.assignee ?? null,
          author: issue.author ?? 'e2e-bot',
          state: issue.state ?? 'open',
          updatedAt: issue.updatedAt ?? null,
          // The cache record carries many pipeline/PR fields that upsert ignores;
          // cast keeps the fixture minimal without enumerating every column.
        } as Parameters<GitHubIssueQueries['upsert']>[0]);
      }
    }

    if (options.notifications?.length) {
      const notifications = new NotificationsQueries(db);
      for (const note of options.notifications) {
        try {
          (notifications as unknown as { create: (input: unknown) => unknown }).create({
            projectId: project.id,
            kind: note.kind,
            title: note.title,
            threadId: note.threadId ?? null,
          });
        } catch {
          // Notification schema drift is non-fatal for seeding; inbox spec also
          // covers the live notification:fire push path.
        }
      }
    }

    return { projectId: project.id, projectPath, issues };
  } finally {
    closeDatabase();
  }
}
