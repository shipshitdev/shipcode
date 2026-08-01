import type { DatabaseSync } from 'node:sqlite';
import {
  buildTaskGraphDraftFromPlan,
  ISO_NOW_SQL,
  type ShipCodePlan,
  type TaskEdgeRecord,
  type TaskGraphAssessment,
  type TaskGraphBuildOptions,
  type TaskGraphMode,
  type TaskGraphStatus,
  type TaskGraphWithNodes,
  type TaskNodeRecord,
  type TaskNodeStatus,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows, transaction } from '../utils';

interface TaskGraphRow {
  id: string;
  thread_id: string;
  plan_id: string;
  mode: TaskGraphMode;
  status: TaskGraphStatus;
  risk_score: number;
  assessment: string;
  created_at: string;
  updated_at: string;
}

interface TaskNodeRow {
  id: string;
  graph_id: string;
  stable_key: string;
  order_index: number;
  title: string;
  description: string;
  status: TaskNodeStatus;
  files: string;
  acceptance_criteria: string;
  surfaces: string;
  agent_role: TaskNodeRecord['agentRole'];
  suggested_executor_model: TaskNodeRecord['suggestedExecutorModel'];
  suggested_reasoning_effort: TaskNodeRecord['suggestedReasoningEffort'];
  github_issue_number: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskEdgeRow {
  id: string;
  graph_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: TaskEdgeRecord['edgeType'];
  created_at: string;
}

export class TaskGraphQueries {
  constructor(private db: DatabaseSync) {}

  replaceForPlan(
    threadId: string,
    planId: string,
    plan: ShipCodePlan,
    options: TaskGraphBuildOptions = {},
  ): TaskGraphWithNodes {
    const draft = buildTaskGraphDraftFromPlan(plan, options);
    const graphId = nanoid();
    const nodeIdByStableKey = new Map<string, string>();

    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE task_graphs
              SET status = 'superseded',
                  updated_at = ${ISO_NOW_SQL}
            WHERE thread_id = ?
              AND status = 'active'`,
        )
        .run(threadId);

      this.db
        .prepare(
          `INSERT INTO task_graphs (
             id,
             thread_id,
             plan_id,
             mode,
             status,
             risk_score,
             assessment
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          graphId,
          threadId,
          planId,
          draft.assessment.mode,
          draft.assessment.riskScore,
          JSON.stringify(draft.assessment),
        );

      const insertNode = this.db.prepare(
        `INSERT INTO task_nodes (
           id,
           graph_id,
           stable_key,
           order_index,
           title,
           description,
           status,
           files,
           acceptance_criteria,
           surfaces,
           agent_role,
           suggested_executor_model,
           suggested_reasoning_effort,
           github_issue_number
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of draft.nodes) {
        const nodeId = nanoid();
        nodeIdByStableKey.set(node.stableKey, nodeId);
        insertNode.run(
          nodeId,
          graphId,
          node.stableKey,
          node.order,
          node.title,
          node.description,
          node.status,
          JSON.stringify(node.files),
          JSON.stringify(node.acceptanceCriteria),
          JSON.stringify(node.surfaces),
          node.agentRole,
          node.suggestedExecutorModel,
          node.suggestedReasoningEffort,
          node.githubIssueNumber,
        );
      }

      const insertEdge = this.db.prepare(
        `INSERT INTO task_edges (
           id,
           graph_id,
           source_node_id,
           target_node_id,
           edge_type
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const edge of draft.edges) {
        const sourceNodeId = nodeIdByStableKey.get(edge.sourceStableKey) as string;
        const targetNodeId = nodeIdByStableKey.get(edge.targetStableKey) as string;
        insertEdge.run(nanoid(), graphId, sourceNodeId, targetNodeId, edge.edgeType);
      }
    });

    return this.getById(graphId) ?? this.failLoad(graphId);
  }

  getById(id: string): TaskGraphWithNodes | null {
    const row = this.db.prepare('SELECT * FROM task_graphs WHERE id = ?').get(id);
    if (!row) return null;
    return this.hydrateGraph(asRow<TaskGraphRow>(row));
  }

  getByPlanId(planId: string): TaskGraphWithNodes | null {
    const row = this.db
      .prepare('SELECT * FROM task_graphs WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(planId);
    return row ? this.hydrateGraph(asRow<TaskGraphRow>(row)) : null;
  }

  getLatestByThread(threadId: string): TaskGraphWithNodes | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM task_graphs
          WHERE thread_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(threadId);
    return row ? this.hydrateGraph(asRow<TaskGraphRow>(row)) : null;
  }

  listByThread(threadId: string): TaskGraphWithNodes[] {
    return asRows<TaskGraphRow>(
      this.db
        .prepare(
          `SELECT *
             FROM task_graphs
            WHERE thread_id = ?
            ORDER BY created_at DESC, rowid DESC`,
        )
        .all(threadId),
    ).map((row) => this.hydrateGraph(row));
  }

  updateNodeStatus(nodeId: string, status: TaskNodeStatus): TaskNodeRecord {
    const timestampColumn =
      status === 'running'
        ? 'started_at'
        : status === 'completed' || status === 'failed' || status === 'blocked'
          ? 'completed_at'
          : null;
    const timestampAssignment = timestampColumn
      ? `, ${timestampColumn} = COALESCE(${timestampColumn}, ${ISO_NOW_SQL})`
      : '';

    this.db
      .prepare(
        `UPDATE task_nodes
            SET status = ?,
                updated_at = ${ISO_NOW_SQL}
                ${timestampAssignment}
          WHERE id = ?`,
      )
      .run(status, nodeId);

    return this.getNodeById(nodeId) ?? this.failLoadNode(nodeId);
  }

  getNextReadyNode(graphId: string): TaskNodeRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM task_nodes
          WHERE graph_id = ?
            AND status = 'ready'
          ORDER BY order_index ASC, rowid ASC
          LIMIT 1`,
      )
      .get(graphId);
    return row ? mapNode(asRow<TaskNodeRow>(row)) : null;
  }

  markNodeCompletedAndPromote(nodeId: string): TaskGraphWithNodes {
    const node = this.getNodeById(nodeId);
    if (!node) this.failLoadNode(nodeId);

    transaction(this.db, () => {
      this.updateNodeStatus(nodeId, 'completed');

      // One grouped pass over every dependent of the completed node, instead of
      // a blocker-count query per dependent (N+1 on the hot completion path —
      // it scaled with graph width). Promotion never flips a node to
      // 'completed', so blocker counts are stable for the whole pass and the
      // batched result is equivalent to re-counting per dependent.
      // `ORDER BY MIN(rowid)` preserves the edge-insertion order the
      // per-dependent loop promoted in.
      const promotableRows = asRows<{ target_node_id: string }>(
        this.db
          .prepare(
            `SELECT dependent.target_node_id AS target_node_id
               FROM task_edges AS dependent
               LEFT JOIN task_edges AS blocker
                      ON blocker.graph_id = dependent.graph_id
                     AND blocker.target_node_id = dependent.target_node_id
                     AND blocker.edge_type IN ('depends_on', 'blocks')
               LEFT JOIN task_nodes AS blocker_source
                      ON blocker_source.id = blocker.source_node_id
                     AND blocker_source.status != 'completed'
              WHERE dependent.graph_id = ?
                AND dependent.source_node_id = ?
                AND dependent.edge_type IN ('depends_on', 'blocks')
              GROUP BY dependent.target_node_id
             HAVING COUNT(blocker_source.id) = 0
              ORDER BY MIN(dependent.rowid) ASC`,
          )
          .all(node.graphId, nodeId),
      );

      const promoteNode = this.db.prepare(
        `UPDATE task_nodes
            SET status = 'ready',
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?
            AND status IN ('pending', 'blocked')`,
      );
      for (const { target_node_id: targetNodeId } of promotableRows) {
        promoteNode.run(targetNodeId);
      }

      const remaining = this.db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM task_nodes
            WHERE graph_id = ?
              AND status != 'completed'`,
        )
        .get(node.graphId) as { count: number };
      if (remaining.count === 0) {
        this.updateGraphStatus(node.graphId, 'completed');
      }
    });

    return this.getById(node.graphId) ?? this.failLoad(node.graphId);
  }

  markNodeFailed(nodeId: string): TaskGraphWithNodes {
    const node = this.getNodeById(nodeId);
    if (!node) this.failLoadNode(nodeId);
    transaction(this.db, () => {
      this.updateNodeStatus(nodeId, 'failed');
      this.updateGraphStatus(node.graphId, 'failed');
    });
    return this.getById(node.graphId) ?? this.failLoad(node.graphId);
  }

  resetForRetry(graphId: string): TaskGraphWithNodes {
    transaction(this.db, () => {
      this.updateGraphStatus(graphId, 'active');
      this.db
        .prepare(
          `UPDATE task_nodes
              SET status = CASE
                    WHEN order_index = (
                      SELECT MIN(order_index)
                        FROM task_nodes
                       WHERE graph_id = ?
                    ) THEN 'ready'
                    ELSE 'pending'
                  END,
                  started_at = NULL,
                  completed_at = NULL,
                  updated_at = ${ISO_NOW_SQL}
            WHERE graph_id = ?`,
        )
        .run(graphId, graphId);
    });

    return this.getById(graphId) ?? this.failLoad(graphId);
  }

  updateGraphStatus(graphId: string, status: TaskGraphStatus): TaskGraphWithNodes {
    this.db
      .prepare(
        `UPDATE task_graphs
            SET status = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(status, graphId);

    return this.getById(graphId) ?? this.failLoad(graphId);
  }

  updateNodeGithubIssueNumber(nodeId: string, issueNumber: number): TaskGraphWithNodes {
    const node = this.getNodeById(nodeId);
    if (!node) this.failLoadNode(nodeId);

    this.db
      .prepare(
        `UPDATE task_nodes
            SET github_issue_number = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(issueNumber, nodeId);

    return this.getById(node.graphId) ?? this.failLoad(node.graphId);
  }

  getNodeById(id: string): TaskNodeRecord | null {
    const row = this.db.prepare('SELECT * FROM task_nodes WHERE id = ?').get(id);
    return row ? mapNode(asRow<TaskNodeRow>(row)) : null;
  }

  private hydrateGraph(row: TaskGraphRow): TaskGraphWithNodes {
    const nodes = asRows<TaskNodeRow>(
      this.db
        .prepare('SELECT * FROM task_nodes WHERE graph_id = ? ORDER BY order_index ASC, rowid ASC')
        .all(row.id),
    ).map(mapNode);
    const edges = asRows<TaskEdgeRow>(
      this.db.prepare('SELECT * FROM task_edges WHERE graph_id = ? ORDER BY rowid ASC').all(row.id),
    ).map(mapEdge);
    return {
      id: row.id,
      threadId: row.thread_id,
      planId: row.plan_id,
      mode: row.mode,
      status: row.status,
      riskScore: row.risk_score,
      assessment: JSON.parse(row.assessment) as TaskGraphAssessment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nodes,
      edges,
    };
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load task graph row: ${id}`);
  }

  private failLoadNode(id: string): never {
    throw new Error(`Failed to load task node row: ${id}`);
  }
}

function parseJsonArray<T>(value: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function mapNode(row: TaskNodeRow): TaskNodeRecord {
  return {
    id: row.id,
    graphId: row.graph_id,
    stableKey: row.stable_key,
    order: row.order_index,
    title: row.title,
    description: row.description,
    status: row.status,
    files: parseJsonArray(row.files),
    acceptanceCriteria: parseJsonArray(row.acceptance_criteria),
    surfaces: parseJsonArray(row.surfaces),
    agentRole: row.agent_role,
    suggestedExecutorModel: row.suggested_executor_model,
    suggestedReasoningEffort: row.suggested_reasoning_effort,
    githubIssueNumber: row.github_issue_number,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEdge(row: TaskEdgeRow): TaskEdgeRecord {
  return {
    id: row.id,
    graphId: row.graph_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    edgeType: row.edge_type,
    createdAt: row.created_at,
  };
}
