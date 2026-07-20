import { z } from 'zod';

export const PR_EVIDENCE_MANIFEST_SCHEMA_VERSION = 1 as const;

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a stable evidence identifier');
const boundedTextSchema = z.string().trim().min(1).max(2_000);
const shortTextSchema = z.string().trim().min(1).max(500);
const commitShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/i, 'must be a git commit SHA');

export const prEvidenceStateSchema = z.enum([
  'proven',
  'unproven',
  'blocked',
  'skipped',
  'not_applicable',
]);

export const prEvidenceReferenceSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(['commit', 'file', 'test', 'ci', 'manual', 'approval', 'log']),
    label: shortTextSchema,
    locator: z.string().trim().min(1).max(2_048).optional(),
    summary: boundedTextSchema.optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((reference, ctx) => {
    if (reference.kind === 'log' && !reference.locator) {
      ctx.addIssue({
        code: 'custom',
        path: ['locator'],
        message: 'Log evidence must be addressable by a locator.',
      });
    }
  });

export const prEvidenceAssessmentSchema = z
  .object({
    subjectId: identifierSchema,
    state: prEvidenceStateSchema,
    evidenceIds: z.array(identifierSchema).max(100),
    reason: boundedTextSchema.optional(),
  })
  .strict()
  .superRefine((assessment, ctx) => {
    if (assessment.state === 'proven' && assessment.evidenceIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Proven evidence states must reference at least one evidence item.',
      });
    }
    if (assessment.state !== 'proven' && !assessment.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `${assessment.state} evidence states require an explicit reason.`,
      });
    }
  });

const contractItemSchema = z
  .object({
    id: identifierSchema,
    text: boundedTextSchema,
  })
  .strict();

const planStepSchema = z
  .object({
    id: identifierSchema,
    order: z.number().int().positive(),
    description: boundedTextSchema,
    files: z.array(z.string().trim().min(1).max(1_024)).max(200),
  })
  .strict();

const changeCommitSchema = z
  .object({
    sha: commitShaSchema,
    summary: shortTextSchema,
  })
  .strict();

const changedFileSchema = z
  .object({
    path: z.string().trim().min(1).max(1_024),
    changeType: z.enum(['added', 'modified', 'deleted', 'renamed']),
    previousPath: z.string().trim().min(1).max(1_024).optional(),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.changeType === 'renamed' && !file.previousPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['previousPath'],
        message: 'Renamed files must record their previous path.',
      });
    }
  });

const permissionSchema = z
  .object({
    capability: identifierSchema,
    status: z.enum(['granted', 'denied', 'not_requested']),
    source: shortTextSchema,
    evidenceIds: z.array(identifierSchema).max(100),
  })
  .strict();

export const prEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal(PR_EVIDENCE_MANIFEST_SCHEMA_VERSION),
    revision: z.number().int().positive(),
    threadId: z.string().trim().min(1).max(256),
    planId: z.string().trim().min(1).max(256),
    createdAt: z.string().datetime(),
    issue: z
      .object({
        repository: z
          .string()
          .trim()
          .regex(/^[^/\s]+\/[^/\s]+$/, 'must use owner/repository form'),
        number: z.number().int().positive(),
        title: shortTextSchema,
        acceptanceCriteria: z.array(contractItemSchema).min(1).max(200),
      })
      .strict(),
    plan: z
      .object({
        id: z.string().trim().min(1).max(256),
        version: z.number().int().positive(),
        objective: boundedTextSchema,
        lockedAt: z.string().datetime(),
        steps: z.array(planStepSchema).min(1).max(200),
      })
      .strict(),
    changes: z
      .object({
        baseSha: commitShaSchema,
        headSha: commitShaSchema,
        commits: z.array(changeCommitSchema).max(500),
        files: z.array(changedFileSchema).max(2_000),
        scopeDrift: z.array(prEvidenceAssessmentSchema).max(200),
      })
      .strict(),
    verification: z
      .object({
        criteria: z.array(prEvidenceAssessmentSchema).min(1).max(200),
        planSteps: z.array(prEvidenceAssessmentSchema).min(1).max(200),
        checks: z.array(prEvidenceAssessmentSchema).max(500),
      })
      .strict(),
    permissions: z
      .object({
        capabilities: z.array(permissionSchema).min(1).max(100),
        approvals: z.array(prEvidenceAssessmentSchema).max(100),
      })
      .strict(),
    unresolvedRisks: z.array(prEvidenceAssessmentSchema).max(200),
    evidence: z.array(prEvidenceReferenceSchema).max(2_000),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.plan.id !== manifest.planId) {
      ctx.addIssue({
        code: 'custom',
        path: ['plan', 'id'],
        message: 'Locked plan id must match manifest planId.',
      });
    }

    const criterionIds = collectUniqueIds(
      manifest.issue.acceptanceCriteria.map((criterion) => criterion.id),
      ['issue', 'acceptanceCriteria'],
      ctx,
    );
    const planStepIds = collectUniqueIds(
      manifest.plan.steps.map((step) => step.id),
      ['plan', 'steps'],
      ctx,
    );
    collectUniqueIds(
      manifest.evidence.map((reference) => reference.id),
      ['evidence'],
      ctx,
    );

    manifest.plan.steps.forEach((step, index) => {
      if (step.order !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['plan', 'steps', index, 'order'],
          message: `Locked plan steps must be sequential; expected ${index + 1}.`,
        });
      }
    });

    validateExactCoverage(
      criterionIds,
      manifest.verification.criteria,
      ['verification', 'criteria'],
      'acceptance criterion',
      ctx,
    );
    validateExactCoverage(
      planStepIds,
      manifest.verification.planSteps,
      ['verification', 'planSteps'],
      'plan step',
      ctx,
    );

    const evidenceIds = new Set(manifest.evidence.map((reference) => reference.id));
    const assessments = [
      ...manifest.changes.scopeDrift,
      ...manifest.verification.criteria,
      ...manifest.verification.planSteps,
      ...manifest.verification.checks,
      ...manifest.permissions.approvals,
      ...manifest.unresolvedRisks,
    ];
    for (const [index, assessment] of assessments.entries()) {
      validateEvidenceReferences(assessment.evidenceIds, evidenceIds, ['assessments', index], ctx);
    }
    manifest.permissions.capabilities.forEach((permission, index) => {
      validateEvidenceReferences(
        permission.evidenceIds,
        evidenceIds,
        ['permissions', 'capabilities', index, 'evidenceIds'],
        ctx,
      );
    });
  });

export type PrEvidenceState = z.infer<typeof prEvidenceStateSchema>;
export type PrEvidenceReference = z.infer<typeof prEvidenceReferenceSchema>;
export type PrEvidenceAssessment = z.infer<typeof prEvidenceAssessmentSchema>;
export type PrEvidenceManifest = z.infer<typeof prEvidenceManifestSchema>;

export function redactEvidenceText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]+)\b/g,
      '[REDACTED]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
      '$1[REDACTED]',
    );
}

export function sanitizePrEvidenceManifest(input: unknown): PrEvidenceManifest {
  return prEvidenceManifestSchema.parse(redactUnknown(input));
}

export function serializePrEvidenceManifest(input: unknown): string {
  return JSON.stringify(sanitizePrEvidenceManifest(input));
}

export function deserializePrEvidenceManifest(serialized: string): PrEvidenceManifest {
  return sanitizePrEvidenceManifest(JSON.parse(serialized) as unknown);
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactEvidenceText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      redactUnknown(entry),
    ]),
  );
}

function collectUniqueIds(
  ids: string[],
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): Set<string> {
  const unique = new Set<string>();
  ids.forEach((id, index) => {
    if (unique.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index, 'id'],
        message: `Duplicate identifier: ${id}`,
      });
    }
    unique.add(id);
  });
  return unique;
}

function validateExactCoverage(
  requiredIds: Set<string>,
  assessments: PrEvidenceAssessment[],
  path: Array<string | number>,
  subjectLabel: string,
  ctx: z.RefinementCtx,
): void {
  const covered = new Set<string>();
  assessments.forEach((assessment, index) => {
    if (covered.has(assessment.subjectId)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index, 'subjectId'],
        message: `Duplicate ${subjectLabel} evidence: ${assessment.subjectId}`,
      });
    }
    covered.add(assessment.subjectId);
    if (!requiredIds.has(assessment.subjectId)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index, 'subjectId'],
        message: `Unknown ${subjectLabel}: ${assessment.subjectId}`,
      });
    }
  });
  for (const requiredId of requiredIds) {
    if (!covered.has(requiredId)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `Missing evidence state for ${subjectLabel}: ${requiredId}`,
      });
    }
  }
}

function validateEvidenceReferences(
  referencedIds: string[],
  evidenceIds: Set<string>,
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): void {
  referencedIds.forEach((evidenceId, index) => {
    if (!evidenceIds.has(evidenceId)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index],
        message: `Unknown evidence identifier: ${evidenceId}`,
      });
    }
  });
}
