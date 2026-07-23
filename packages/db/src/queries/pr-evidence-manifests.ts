import type { DatabaseSync } from 'node:sqlite';
import {
  deserializePrEvidenceManifest,
  type PrEvidenceManifest,
  serializePrEvidenceManifest,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PrEvidenceManifestRow {
  id: string;
  thread_id: string;
  plan_id: string;
  schema_version: number;
  revision: number;
  idempotency_key: string;
  manifest_json: string;
  created_at: string;
  updated_at: string;
}

export interface PrEvidenceManifestRecord {
  id: string;
  threadId: string;
  planId: string;
  schemaVersion: number;
  revision: number;
  idempotencyKey: string;
  manifest: PrEvidenceManifest;
  createdAt: string;
  updatedAt: string;
}

export interface SavePrEvidenceManifestInput {
  idempotencyKey: string;
  manifest: unknown;
}

export class PrEvidenceManifestQueries {
  constructor(private db: DatabaseSync) {}

  save(input: SavePrEvidenceManifestInput): PrEvidenceManifestRecord {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error('PR evidence idempotency key is required.');
    if (idempotencyKey.length > 256) {
      throw new Error('PR evidence idempotency key must be at most 256 characters.');
    }

    const serialized = serializePrEvidenceManifest(input.manifest);
    const manifest = deserializePrEvidenceManifest(serialized);
    this.assertPlanOwnership(manifest.threadId, manifest.planId);

    const existingByKey = this.getRowByIdempotencyKey(idempotencyKey);
    if (existingByKey) return this.assertIdempotent(existingByKey, serialized);

    const existingRevision = this.getRowByPlanRevision(manifest.planId, manifest.revision);
    if (existingRevision) {
      throw new Error(
        `PR evidence revision ${manifest.revision} already exists for plan ${manifest.planId}.`,
      );
    }

    const id = nanoid();
    const result = this.db
      .prepare(
        `INSERT INTO pr_evidence_manifests (
           id,
           thread_id,
           plan_id,
           schema_version,
           revision,
           idempotency_key,
           manifest_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        id,
        manifest.threadId,
        manifest.planId,
        manifest.schemaVersion,
        manifest.revision,
        idempotencyKey,
        serialized,
      );

    if (Number(result.changes) === 0) {
      const raced = this.getRowByIdempotencyKey(idempotencyKey);
      if (!raced) throw new Error('Failed to resolve idempotent PR evidence write.');
      return this.assertIdempotent(raced, serialized);
    }

    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): PrEvidenceManifestRecord | null {
    const row = this.db.prepare('SELECT * FROM pr_evidence_manifests WHERE id = ?').get(id);
    return row ? mapRow(asRow<PrEvidenceManifestRow>(row)) : null;
  }

  getByPlanId(planId: string): PrEvidenceManifestRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
           FROM pr_evidence_manifests
          WHERE plan_id = ?
          ORDER BY revision DESC, updated_at DESC, rowid DESC`,
      )
      .all(planId);
    return asRows<PrEvidenceManifestRow>(rows).map(mapRow);
  }

  getLatestByThread(threadId: string): PrEvidenceManifestRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM pr_evidence_manifests
          WHERE thread_id = ?
          ORDER BY updated_at DESC, revision DESC, rowid DESC
          LIMIT 1`,
      )
      .get(threadId);
    return row ? mapRow(asRow<PrEvidenceManifestRow>(row)) : null;
  }

  private assertPlanOwnership(threadId: string, planId: string): void {
    const plan = this.db.prepare('SELECT thread_id FROM plans WHERE id = ?').get(planId) as
      | { thread_id: string }
      | undefined;
    if (!plan) throw new Error(`Cannot persist PR evidence for missing plan: ${planId}`);
    if (plan.thread_id !== threadId) {
      throw new Error(`PR evidence plan ${planId} does not belong to thread ${threadId}.`);
    }
  }

  private getRowByIdempotencyKey(idempotencyKey: string): PrEvidenceManifestRow | null {
    const row = this.db
      .prepare('SELECT * FROM pr_evidence_manifests WHERE idempotency_key = ?')
      .get(idempotencyKey);
    return row ? asRow<PrEvidenceManifestRow>(row) : null;
  }

  private getRowByPlanRevision(planId: string, revision: number): PrEvidenceManifestRow | null {
    const row = this.db
      .prepare('SELECT * FROM pr_evidence_manifests WHERE plan_id = ? AND revision = ?')
      .get(planId, revision);
    return row ? asRow<PrEvidenceManifestRow>(row) : null;
  }

  private assertIdempotent(
    existing: PrEvidenceManifestRow,
    serialized: string,
  ): PrEvidenceManifestRecord {
    if (existing.manifest_json !== serialized) {
      throw new Error(
        `PR evidence idempotency key ${existing.idempotency_key} was reused with different content.`,
      );
    }
    return mapRow(existing);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load PR evidence manifest row: ${id}`);
  }
}

function mapRow(row: PrEvidenceManifestRow): PrEvidenceManifestRecord {
  try {
    return {
      id: row.id,
      threadId: row.thread_id,
      planId: row.plan_id,
      schemaVersion: row.schema_version,
      revision: row.revision,
      idempotencyKey: row.idempotency_key,
      manifest: deserializePrEvidenceManifest(row.manifest_json),
      createdAt: toIsoUtc(row.created_at) ?? row.created_at,
      updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(`Invalid PR evidence manifest row ${row.id}: ${message.slice(0, 240)}`);
  }
}
