import type { DatabaseSync } from 'node:sqlite';
import type {
  IssueGraphEdgeRecord,
  IssueGraphEdgeType,
  IssueGraphNodeRecord,
  ProjectIssueGraph,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows, transaction } from '../utils';

const ISSUE_EDGES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS issue_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
    target_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL CHECK (edge_type IN ('blocks', 'depends_on', 'reference')),
    origin TEXT NOT NULL CHECK (origin IN ('body', 'manual')),
    source_body_issue_id TEXT REFERENCES github_issue_cache(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (source_issue_id <> target_issue_id)
  );

  CREATE INDEX IF NOT EXISTS idx_issue_edges_project ON issue_edges(project_id);
  CREATE INDEX IF NOT EXISTS idx_issue_edges_source ON issue_edges(source_issue_id);
  CREATE INDEX IF NOT EXISTS idx_issue_edges_target ON issue_edges(target_issue_id);
  CREATE INDEX IF NOT EXISTS idx_issue_edges_type ON issue_edges(edge_type);
  CREATE INDEX IF NOT EXISTS idx_issue_edges_source_body ON issue_edges(source_body_issue_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_manual
    ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin)
    WHERE source_body_issue_id IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_body
    ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin, source_body_issue_id)
    WHERE source_body_issue_id IS NOT NULL;
`;

interface IssueEdgeRow {
  id: string;
  project_id: string;
  source_issue_id: string;
  target_issue_id: string;
  source_issue_number: number;
  target_issue_number: number;
  edge_type: IssueGraphEdgeType;
  origin: 'body' | 'manual';
  created_at: string;
  updated_at: string;
}

interface IssueNodeRow {
  issue_id: string;
  project_id: string;
  issue_number: number;
  title: string;
  state: string;
  pipeline_status: IssueGraphNodeRecord['pipelineStatus'];
  thread_id: string | null;
}

export class IssueEdgeQueries {
  constructor(private db: DatabaseSync) {
    this.db.exec(ISSUE_EDGES_SCHEMA_SQL);
  }

  loadProjectGraph(projectId: string): ProjectIssueGraph {
    const nodeRows = this.db
      .prepare(
        `SELECT
           id AS issue_id,
           project_id,
           issue_number,
           title,
           state,
           pipeline_status,
           thread_id
         FROM github_issue_cache
         WHERE project_id = ?
           AND archived_at IS NULL
         ORDER BY issue_number ASC`,
      )
      .all(projectId);
    const edgeRows = this.db
      .prepare(
        `SELECT
           edges.id,
           edges.project_id,
           edges.source_issue_id,
           edges.target_issue_id,
           source.issue_number AS source_issue_number,
           target.issue_number AS target_issue_number,
           edges.edge_type,
           edges.origin,
           edges.created_at,
           edges.updated_at
         FROM issue_edges AS edges
         INNER JOIN github_issue_cache AS source ON source.id = edges.source_issue_id
         INNER JOIN github_issue_cache AS target ON target.id = edges.target_issue_id
         WHERE edges.project_id = ?
           AND source.archived_at IS NULL
           AND target.archived_at IS NULL
         ORDER BY source.issue_number ASC, target.issue_number ASC, edges.edge_type ASC`,
      )
      .all(projectId);

    return {
      projectId,
      nodes: asRows<IssueNodeRow>(nodeRows).map(mapIssueNodeRow),
      edges: asRows<IssueEdgeRow>(edgeRows).map(mapIssueEdgeRow),
    };
  }

  replaceBodyEdges(
    projectId: string,
    sourceBodyIssueId: string,
    edges: Array<{
      sourceIssueId: string;
      targetIssueId: string;
      edgeType: Exclude<IssueGraphEdgeType, never>;
    }>,
  ): IssueGraphEdgeRecord[] {
    transaction(this.db, () => {
      this.db
        .prepare(
          `DELETE FROM issue_edges
            WHERE project_id = ?
              AND origin = 'body'
              AND source_body_issue_id = ?`,
        )
        .run(projectId, sourceBodyIssueId);

      for (const edge of edges) {
        if (edge.sourceIssueId === edge.targetIssueId) {
          continue;
        }
        this.db
          .prepare(
            `INSERT OR IGNORE INTO issue_edges (
               id,
               project_id,
               source_issue_id,
               target_issue_id,
               edge_type,
               origin,
               source_body_issue_id
             ) VALUES (?, ?, ?, ?, ?, 'body', ?)`,
          )
          .run(
            nanoid(),
            projectId,
            edge.sourceIssueId,
            edge.targetIssueId,
            edge.edgeType,
            sourceBodyIssueId,
          );
      }
    });

    return this.loadProjectGraph(projectId).edges.filter((edge) => edge.origin === 'body');
  }

  createManualEdge(input: {
    projectId: string;
    sourceIssueId: string;
    targetIssueId: string;
    edgeType: IssueGraphEdgeType;
  }): IssueGraphEdgeRecord {
    if (input.sourceIssueId === input.targetIssueId) {
      throw new Error('Cannot create a self edge');
    }

    const existing = this.findExistingManualEdge(
      input.projectId,
      input.sourceIssueId,
      input.targetIssueId,
      input.edgeType,
    );
    if (existing) return existing;

    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO issue_edges (
           id,
           project_id,
           source_issue_id,
           target_issue_id,
           edge_type,
           origin
         ) VALUES (?, ?, ?, ?, ?, 'manual')`,
      )
      .run(id, input.projectId, input.sourceIssueId, input.targetIssueId, input.edgeType);

    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to load manual issue edge after insert: ${id}`);
    }
    return created;
  }

  deleteEdge(id: string): boolean {
    const result = this.db.prepare('DELETE FROM issue_edges WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  private findExistingManualEdge(
    projectId: string,
    sourceIssueId: string,
    targetIssueId: string,
    edgeType: IssueGraphEdgeType,
  ): IssueGraphEdgeRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           edges.id,
           edges.project_id,
           edges.source_issue_id,
           edges.target_issue_id,
           source.issue_number AS source_issue_number,
           target.issue_number AS target_issue_number,
           edges.edge_type,
           edges.origin,
           edges.created_at,
           edges.updated_at
         FROM issue_edges AS edges
         INNER JOIN github_issue_cache AS source ON source.id = edges.source_issue_id
         INNER JOIN github_issue_cache AS target ON target.id = edges.target_issue_id
         WHERE edges.project_id = ?
           AND edges.source_issue_id = ?
           AND edges.target_issue_id = ?
           AND edges.edge_type = ?
           AND edges.origin = 'manual'
         LIMIT 1`,
      )
      .get(projectId, sourceIssueId, targetIssueId, edgeType);
    return row ? mapIssueEdgeRow(asRow<IssueEdgeRow>(row)) : null;
  }

  private getById(id: string): IssueGraphEdgeRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           edges.id,
           edges.project_id,
           edges.source_issue_id,
           edges.target_issue_id,
           source.issue_number AS source_issue_number,
           target.issue_number AS target_issue_number,
           edges.edge_type,
           edges.origin,
           edges.created_at,
           edges.updated_at
         FROM issue_edges AS edges
         INNER JOIN github_issue_cache AS source ON source.id = edges.source_issue_id
         INNER JOIN github_issue_cache AS target ON target.id = edges.target_issue_id
         WHERE edges.id = ?`,
      )
      .get(id);
    return row ? mapIssueEdgeRow(asRow<IssueEdgeRow>(row)) : null;
  }
}

function mapIssueNodeRow(row: IssueNodeRow): IssueGraphNodeRecord {
  return {
    issueId: row.issue_id,
    projectId: row.project_id,
    issueNumber: row.issue_number,
    title: row.title,
    state: row.state,
    pipelineStatus: row.pipeline_status,
    threadId: row.thread_id,
  };
}

function mapIssueEdgeRow(row: IssueEdgeRow): IssueGraphEdgeRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceIssueId: row.source_issue_id,
    targetIssueId: row.target_issue_id,
    sourceIssueNumber: row.source_issue_number,
    targetIssueNumber: row.target_issue_number,
    edgeType: row.edge_type,
    origin: row.origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
