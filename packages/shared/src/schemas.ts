import { z } from 'zod'

export const planStepSchema = z.object({
  order: z.number().int().positive(),
  description: z.string().min(1),
  files: z.array(z.string()),
  rationale: z.string().min(1),
})

export const planFileChangeSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['create', 'modify', 'delete', 'rename']),
  description: z.string().min(1),
  fromPath: z.string().optional(),
})

export const shipCodePlanSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  version: z.number().int().positive(),
  objective: z.string().min(1),
  files: z.array(planFileChangeSchema),
  steps: z.array(planStepSchema),
  acceptanceCriteria: z.array(z.string()),
  outOfScope: z.array(z.string()),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  dependencies: z.array(z.string()),
})

export const reviewFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['critical', 'major', 'minor', 'nit']),
  category: z.enum(['correctness', 'security', 'performance', 'design', 'missing']),
  filePath: z.string().optional(),
  stepOrder: z.number().optional(),
  description: z.string().min(1),
  suggestion: z.string().optional(),
})

export const planReviewSchema = z.object({
  planId: z.string().min(1),
  decision: z.enum(['approve', 'request_changes', 'reject']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string().min(1),
  findings: z.array(reviewFindingSchema),
  suggestedChanges: z.array(z.string()),
})

export const criteriaCheckSchema = z.object({
  criterion: z.string().min(1),
  passed: z.boolean(),
  evidence: z.string().min(1),
})

export const verificationIssueSchema = z.object({
  severity: z.enum(['blocker', 'warning']),
  description: z.string().min(1),
  filePath: z.string().optional(),
})

export const verificationResultSchema = z.object({
  threadId: z.string().min(1),
  planId: z.string().min(1),
  result: z.enum(['passed', 'failed']),
  summary: z.string().min(1),
  criteriaResults: z.array(criteriaCheckSchema),
  issues: z.array(verificationIssueSchema),
})
