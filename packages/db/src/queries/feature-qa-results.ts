import type { DatabaseSync } from 'node:sqlite';
import type { FeatureQaFlowResult } from '@shipcode/shared';
import { toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

export interface FeatureQaResultRecord {
  id: string;
  threadId: string;
  featureId: string;
  status: 'passed' | 'failed' | 'partial';
  flowResults: FeatureQaFlowResult[];
  summary: string;
  evidencePaths: string[] | null;
  runAt: string;
  createdAt: string;
}

export interface InsertFeatureQaResult {
  threadId: string;
  featureId: string;
  status: 'passed' | 'failed' | 'partial';
  flowResults: FeatureQaFlowResult[];
  summary: string;
  evidencePaths?: string[] | null;
  runAt?: string;
}

interface FeatureQaResultRow {
  id: string;
  thread_id: string;
  feature_id: string;
  status: 'passed' | 'failed' | 'partial';
  flow_results: string;
  summary: string;
  evidence_paths: string | null;
  run_at: string;
  created_at: string;
}

export class FeatureQaResultQueries {
  constructor(private db: DatabaseSync) {}

  insert(input: InsertFeatureQaResult): FeatureQaResultRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO feature_qa_results
          (id, thread_id, feature_id, status, flow_results, summary, evidence_paths, run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
      )
      .run(
        id,
        input.threadId,
        input.featureId,
        input.status,
        JSON.stringify(input.flowResults),
        input.summary,
        input.evidencePaths ? JSON.stringify(input.evidencePaths) : null,
        input.runAt ?? null,
      );
    const created = this.getById(id);
    if (!created) throw new Error(`Failed to load feature QA result after insert: ${id}`);
    return created;
  }

  getById(id: string): FeatureQaResultRecord | null {
    const row = this.db.prepare('SELECT * FROM feature_qa_results WHERE id = ?').get(id);
    return row ? this.toRecord(asRow<FeatureQaResultRow>(row)) : null;
  }

  listByThread(threadId: string): FeatureQaResultRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM feature_qa_results WHERE thread_id = ? ORDER BY run_at DESC LIMIT 100',
      )
      .all(threadId);
    return asRows<FeatureQaResultRow>(rows).map((r) => this.toRecord(r));
  }

  listByFeature(featureId: string): FeatureQaResultRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM feature_qa_results WHERE feature_id = ? ORDER BY run_at DESC LIMIT 100',
      )
      .all(featureId);
    return asRows<FeatureQaResultRow>(rows).map((r) => this.toRecord(r));
  }

  latestByFeature(featureId: string): FeatureQaResultRecord | null {
    const row = this.db
      .prepare('SELECT * FROM feature_qa_results WHERE feature_id = ? ORDER BY run_at DESC LIMIT 1')
      .get(featureId);
    return row ? this.toRecord(asRow<FeatureQaResultRow>(row)) : null;
  }

  private toRecord(row: FeatureQaResultRow): FeatureQaResultRecord {
    let flowResults: FeatureQaFlowResult[] = [];
    try {
      flowResults = JSON.parse(row.flow_results) as FeatureQaFlowResult[];
    } catch {
      flowResults = [];
    }

    let evidencePaths: string[] | null = null;
    if (row.evidence_paths) {
      try {
        evidencePaths = JSON.parse(row.evidence_paths) as string[];
      } catch {
        evidencePaths = null;
      }
    }

    return {
      id: row.id,
      threadId: row.thread_id,
      featureId: row.feature_id,
      status: row.status,
      flowResults,
      summary: row.summary,
      evidencePaths,
      runAt: toIsoUtc(row.run_at) ?? row.run_at,
      createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    };
  }
}
