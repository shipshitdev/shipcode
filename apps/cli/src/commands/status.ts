import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, ProjectQueries, ThreadQueries } from '@shipcode/db';
import { PIPELINE_PHASE, type PipelinePhase } from '@shipcode/shared';
import { sanitizeCliText } from '../adapters/cli-emitter';

const INACTIVE_THREAD_STATUSES = new Set<PipelinePhase>([
  PIPELINE_PHASE.idle,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.failed,
]);

export async function statusCommand() {
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data');
  if (!fs.existsSync(path.join(dataDir, 'shipcode.db'))) {
    console.log('No ShipCode database found. Run a pipeline first.');
    return;
  }

  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);
  const threads = new ThreadQueries(db);

  const allProjects = projects.list();
  if (allProjects.length === 0) {
    console.log('No projects registered.');
    return;
  }

  for (const project of allProjects) {
    console.log(`\n${sanitizeCliText(project.name)} (${sanitizeCliText(project.path)})`);
    const projectThreads = threads.list(project.id);
    const active = projectThreads.filter((t) => !INACTIVE_THREAD_STATUSES.has(t.status));
    const recent = projectThreads.slice(0, 5);

    if (active.length > 0) {
      console.log('  Active:');
      for (const t of active) {
        console.log(`    [${sanitizeCliText(t.status)}] ${sanitizeCliText(t.title)}`);
      }
    }

    if (recent.length > 0 && active.length === 0) {
      console.log('  Recent:');
      for (const t of recent) {
        console.log(`    [${sanitizeCliText(t.status)}] ${sanitizeCliText(t.title)}`);
      }
    }
  }
}
