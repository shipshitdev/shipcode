import { z } from 'zod';

export const planStepSchema = z.object({
  order: z.number().int().positive(),
  description: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
});

export const planFileChangeSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['create', 'modify', 'delete', 'rename']),
  description: z.string().min(1),
  fromPath: z.string().optional(),
});

export const shipCodePlanSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    version: z.number().int().positive(),
    objective: z.string().min(1),
    files: z.array(planFileChangeSchema).min(1),
    steps: z.array(planStepSchema).length(3),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    outOfScope: z.array(z.string().min(1)).min(1),
    estimatedComplexity: z.enum(['low', 'medium', 'high']),
    dependencies: z.array(z.string().min(1)),
  })
  .superRefine((plan, ctx) => {
    const declaredFiles = new Set(plan.files.map((file) => file.path));
    const referencedFiles = new Set<string>();

    for (const [index, step] of plan.steps.entries()) {
      const expectedOrder = index + 1;
      if (step.order !== expectedOrder) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'order'],
          message: `Plan steps must be ordered sequentially; expected ${expectedOrder}.`,
        });
      }

      for (const file of step.files) {
        referencedFiles.add(file);
        if (!declaredFiles.has(file)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', index, 'files'],
            message: `Step references undeclared file: ${file}`,
          });
        }
      }
    }

    for (const [index, file] of plan.files.entries()) {
      if (!referencedFiles.has(file.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: `Declared file is not referenced by any step: ${file.path}`,
        });
      }
    }
  });

export const clarificationChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  recommended: z.boolean().optional(),
});

export const clarificationQuestionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  choices: z.array(clarificationChoiceSchema).min(2).max(4),
  allowFreeform: z.boolean().default(false),
  freeformPlaceholder: z.string().nullable().optional().default(null),
});

export const clarificationRequestSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  phase: z.enum(['plan', 'revision']),
  summary: z.string().min(1),
  questions: z.array(clarificationQuestionSchema).min(1).max(3),
});

export const clarificationAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedChoiceId: z.string().nullable().optional().default(null),
  freeformText: z.string().nullable().optional().default(null),
});

export const answeredClarificationSchema = z.object({
  request: clarificationRequestSchema,
  answers: z.array(clarificationAnswerSchema),
});

export const reviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['critical', 'major', 'minor', 'nit']),
  category: z.enum(['correctness', 'security', 'performance', 'design', 'missing']),
  filePath: z.string().optional(),
  stepOrder: z.number().optional(),
  description: z.string().min(1),
  suggestion: z.string().optional(),
});

export const planReviewSchema = z.object({
  planId: z.string().min(1),
  decision: z.enum(['approve', 'request_changes', 'reject']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string().min(1),
  findings: z.array(reviewFindingSchema),
  suggestedChanges: z.array(z.string()),
});

export const criteriaCheckSchema = z.object({
  criterion: z.string().min(1),
  passed: z.boolean(),
  evidence: z.string().min(1),
});

export const verificationIssueSchema = z.object({
  severity: z.enum(['blocker', 'warning']),
  description: z.string().min(1),
  filePath: z.string().optional(),
});

export const verificationResultSchema = z.object({
  threadId: z.string().min(1),
  planId: z.string().min(1),
  result: z.enum(['passed', 'failed']),
  summary: z.string().min(1),
  criteriaResults: z.array(criteriaCheckSchema),
  issues: z.array(verificationIssueSchema),
});

// === Feature QA State ===

export const featureQaCriticalFlowSchema = z.object({
  name: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  successCriteria: z.string().min(1),
});

export const featureQaStateSchema = z.object({
  featureId: z.string().min(1),
  routes: z.array(z.string().min(1)),
  criticalFlows: z.array(featureQaCriticalFlowSchema).min(1),
  expectedStates: z.array(z.string().min(1)),
  testDataAssumptions: z.array(z.string()),
  selectorReadiness: z.enum(['ready', 'partial', 'missing']),
});

export const featureQaFlowResultSchema = z.object({
  flowName: z.string().min(1),
  passed: z.boolean(),
  failureReason: z.string().optional(),
});

/**
 * Parse raw JSON into validated FeatureQaFlowResult[].
 * Returns empty array on any parse/validation failure.
 */
export function parseFeatureQaFlowResults(
  raw: unknown,
): z.infer<typeof featureQaFlowResultSchema>[] {
  try {
    return z.array(featureQaFlowResultSchema).parse(raw);
  } catch {
    return [];
  }
}

export const featureQaResultSchema = z.object({
  featureId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'partial']),
  flowResults: z.array(featureQaFlowResultSchema),
  summary: z.string().min(1),
  evidencePaths: z.array(z.string()).optional(),
  runAt: z.string().min(1),
});

export const repoSetupEnvFileSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1).optional(),
  required: z.boolean().default(true),
});

export const runtimeQaServerSchema = z.object({
  command: z.string().min(1),
  readinessUrl: z.string().min(1),
  startupTimeoutMs: z.number().int().min(1000).default(60_000),
  portEnvVar: z.string().min(1).default('PORT'),
});

export const runtimeQaConfigSchema = z.object({
  server: runtimeQaServerSchema.optional(),
  testCommands: z.array(z.string().min(1)).default([]),
  discoverAgentTests: z.boolean().default(true),
});

export const repoSetupContractSchema = z.object({
  version: z.literal(1).default(1),
  setupCommands: z.array(z.string().min(1)).default([]),
  verifyCommands: z.array(z.string().min(1)).default([]),
  envFiles: z.array(repoSetupEnvFileSchema).default([]),
  setupBeforeVerify: z.boolean().default(false),
  testingContext: z.string().min(1).nullable().optional().default(null),
  runtimeQa: runtimeQaConfigSchema.optional(),
});
