import { describe, it, expect } from 'vitest'
import {
	shipCodePlanSchema,
	planFileChangeSchema,
	planStepSchema,
	planReviewSchema,
	reviewFindingSchema,
	verificationResultSchema,
	criteriaCheckSchema,
	verificationIssueSchema,
} from './schemas'

// ── Fixtures ──────────────────────────────────────────────────────────────

const validFileChange = {
	path: 'src/index.ts',
	action: 'create' as const,
	description: 'Create the entry point',
}

const validStep = {
	order: 1,
	description: 'Set up project scaffolding',
	files: ['src/index.ts'],
	rationale: 'Need an entry point before adding features',
}

const validPlan = {
	id: 'plan-001',
	threadId: 'thread-abc',
	version: 1,
	objective: 'Build the auth module',
	files: [validFileChange],
	steps: [validStep],
	acceptanceCriteria: ['Users can log in'],
	outOfScope: ['Password reset'],
	estimatedComplexity: 'medium' as const,
	dependencies: ['zod'],
}

const validFinding = {
	id: 'finding-1',
	severity: 'major' as const,
	category: 'correctness' as const,
	description: 'Missing null check on user input',
}

const validReview = {
	planId: 'plan-001',
	decision: 'approve' as const,
	confidence: 'high' as const,
	summary: 'Plan looks solid overall',
	findings: [validFinding],
	suggestedChanges: ['Add error handling'],
}

const validCriteriaCheck = {
	criterion: 'Users can log in',
	passed: true,
	evidence: 'Login endpoint returns 200 with valid credentials',
}

const validIssue = {
	severity: 'warning' as const,
	description: 'No rate limiting on login endpoint',
}

const validVerification = {
	threadId: 'thread-abc',
	planId: 'plan-001',
	result: 'passed' as const,
	summary: 'All criteria met',
	criteriaResults: [validCriteriaCheck],
	issues: [validIssue],
}

// ── planFileChangeSchema ──────────────────────────────────────────────────

describe('planFileChangeSchema', () => {
	it('accepts a valid file change', () => {
		expect(planFileChangeSchema.parse(validFileChange)).toEqual(validFileChange)
	})

	it('accepts optional fromPath', () => {
		const withFrom = { ...validFileChange, action: 'rename', fromPath: 'old/path.ts' }
		expect(planFileChangeSchema.parse(withFrom)).toEqual(withFrom)
	})

	it('rejects empty path', () => {
		expect(() => planFileChangeSchema.parse({ ...validFileChange, path: '' })).toThrow()
	})

	it('rejects empty description', () => {
		expect(() =>
			planFileChangeSchema.parse({ ...validFileChange, description: '' })
		).toThrow()
	})

	it('rejects invalid action', () => {
		expect(() =>
			planFileChangeSchema.parse({ ...validFileChange, action: 'move' })
		).toThrow()
	})

	it('rejects missing required fields', () => {
		expect(() => planFileChangeSchema.parse({})).toThrow()
		expect(() => planFileChangeSchema.parse({ path: 'a.ts' })).toThrow()
	})
})

// ── planStepSchema ────────────────────────────────────────────────────────

describe('planStepSchema', () => {
	it('accepts a valid step', () => {
		expect(planStepSchema.parse(validStep)).toEqual(validStep)
	})

	it('rejects zero order', () => {
		expect(() => planStepSchema.parse({ ...validStep, order: 0 })).toThrow()
	})

	it('rejects negative order', () => {
		expect(() => planStepSchema.parse({ ...validStep, order: -1 })).toThrow()
	})

	it('rejects non-integer order', () => {
		expect(() => planStepSchema.parse({ ...validStep, order: 1.5 })).toThrow()
	})

	it('rejects empty description', () => {
		expect(() => planStepSchema.parse({ ...validStep, description: '' })).toThrow()
	})

	it('rejects empty rationale', () => {
		expect(() => planStepSchema.parse({ ...validStep, rationale: '' })).toThrow()
	})

	it('accepts empty files array', () => {
		expect(planStepSchema.parse({ ...validStep, files: [] })).toEqual({
			...validStep,
			files: [],
		})
	})
})

// ── shipCodePlanSchema ────────────────────────────────────────────────────

describe('shipCodePlanSchema', () => {
	it('accepts a valid plan', () => {
		expect(shipCodePlanSchema.parse(validPlan)).toEqual(validPlan)
	})

	it('rejects empty id', () => {
		expect(() => shipCodePlanSchema.parse({ ...validPlan, id: '' })).toThrow()
	})

	it('rejects empty threadId', () => {
		expect(() => shipCodePlanSchema.parse({ ...validPlan, threadId: '' })).toThrow()
	})

	it('rejects zero version', () => {
		expect(() => shipCodePlanSchema.parse({ ...validPlan, version: 0 })).toThrow()
	})

	it('rejects non-integer version', () => {
		expect(() => shipCodePlanSchema.parse({ ...validPlan, version: 1.2 })).toThrow()
	})

	it('rejects empty objective', () => {
		expect(() => shipCodePlanSchema.parse({ ...validPlan, objective: '' })).toThrow()
	})

	it('rejects invalid estimatedComplexity', () => {
		expect(() =>
			shipCodePlanSchema.parse({ ...validPlan, estimatedComplexity: 'extreme' })
		).toThrow()
	})

	it('accepts all valid complexity values', () => {
		for (const c of ['low', 'medium', 'high']) {
			expect(
				shipCodePlanSchema.parse({ ...validPlan, estimatedComplexity: c })
			).toBeTruthy()
		}
	})

	it('accepts empty arrays for acceptanceCriteria, outOfScope, dependencies', () => {
		const plan = {
			...validPlan,
			acceptanceCriteria: [],
			outOfScope: [],
			dependencies: [],
		}
		expect(shipCodePlanSchema.parse(plan)).toEqual(plan)
	})

	it('rejects missing required fields', () => {
		expect(() => shipCodePlanSchema.parse({})).toThrow()
	})

	it('propagates nested file change validation', () => {
		expect(() =>
			shipCodePlanSchema.parse({
				...validPlan,
				files: [{ ...validFileChange, path: '' }],
			})
		).toThrow()
	})

	it('propagates nested step validation', () => {
		expect(() =>
			shipCodePlanSchema.parse({
				...validPlan,
				steps: [{ ...validStep, order: 0 }],
			})
		).toThrow()
	})
})

// ── reviewFindingSchema ───────────────────────────────────────────────────

describe('reviewFindingSchema', () => {
	it('accepts a valid finding', () => {
		expect(reviewFindingSchema.parse(validFinding)).toEqual(validFinding)
	})

	it('accepts optional filePath and stepOrder', () => {
		const full = { ...validFinding, filePath: 'src/auth.ts', stepOrder: 2 }
		expect(reviewFindingSchema.parse(full)).toEqual(full)
	})

	it('accepts optional suggestion', () => {
		const full = { ...validFinding, suggestion: 'Add a guard clause' }
		expect(reviewFindingSchema.parse(full)).toEqual(full)
	})

	it('rejects empty id', () => {
		expect(() => reviewFindingSchema.parse({ ...validFinding, id: '' })).toThrow()
	})

	it('rejects invalid severity', () => {
		expect(() =>
			reviewFindingSchema.parse({ ...validFinding, severity: 'blocker' })
		).toThrow()
	})

	it('accepts all valid severities', () => {
		for (const s of ['critical', 'major', 'minor', 'nit']) {
			expect(
				reviewFindingSchema.parse({ ...validFinding, severity: s })
			).toBeTruthy()
		}
	})

	it('rejects invalid category', () => {
		expect(() =>
			reviewFindingSchema.parse({ ...validFinding, category: 'style' })
		).toThrow()
	})

	it('accepts all valid categories', () => {
		for (const c of ['correctness', 'security', 'performance', 'design', 'missing']) {
			expect(
				reviewFindingSchema.parse({ ...validFinding, category: c })
			).toBeTruthy()
		}
	})

	it('rejects empty description', () => {
		expect(() =>
			reviewFindingSchema.parse({ ...validFinding, description: '' })
		).toThrow()
	})
})

// ── planReviewSchema ──────────────────────────────────────────────────────

describe('planReviewSchema', () => {
	it('accepts a valid review', () => {
		expect(planReviewSchema.parse(validReview)).toEqual(validReview)
	})

	it('rejects empty planId', () => {
		expect(() => planReviewSchema.parse({ ...validReview, planId: '' })).toThrow()
	})

	it('rejects invalid decision', () => {
		expect(() =>
			planReviewSchema.parse({ ...validReview, decision: 'defer' })
		).toThrow()
	})

	it('accepts all valid decisions', () => {
		for (const d of ['approve', 'request_changes', 'reject']) {
			expect(
				planReviewSchema.parse({ ...validReview, decision: d })
			).toBeTruthy()
		}
	})

	it('rejects invalid confidence', () => {
		expect(() =>
			planReviewSchema.parse({ ...validReview, confidence: 'very_high' })
		).toThrow()
	})

	it('accepts all valid confidence values', () => {
		for (const c of ['high', 'medium', 'low']) {
			expect(
				planReviewSchema.parse({ ...validReview, confidence: c })
			).toBeTruthy()
		}
	})

	it('rejects empty summary', () => {
		expect(() => planReviewSchema.parse({ ...validReview, summary: '' })).toThrow()
	})

	it('accepts empty findings array', () => {
		const review = { ...validReview, findings: [] }
		expect(planReviewSchema.parse(review)).toEqual(review)
	})

	it('accepts empty suggestedChanges array', () => {
		const review = { ...validReview, suggestedChanges: [] }
		expect(planReviewSchema.parse(review)).toEqual(review)
	})

	it('propagates nested finding validation', () => {
		expect(() =>
			planReviewSchema.parse({
				...validReview,
				findings: [{ ...validFinding, id: '' }],
			})
		).toThrow()
	})
})

// ── criteriaCheckSchema ───────────────────────────────────────────────────

describe('criteriaCheckSchema', () => {
	it('accepts a valid criteria check', () => {
		expect(criteriaCheckSchema.parse(validCriteriaCheck)).toEqual(validCriteriaCheck)
	})

	it('rejects empty criterion', () => {
		expect(() =>
			criteriaCheckSchema.parse({ ...validCriteriaCheck, criterion: '' })
		).toThrow()
	})

	it('rejects empty evidence', () => {
		expect(() =>
			criteriaCheckSchema.parse({ ...validCriteriaCheck, evidence: '' })
		).toThrow()
	})

	it('rejects non-boolean passed', () => {
		expect(() =>
			criteriaCheckSchema.parse({ ...validCriteriaCheck, passed: 'yes' })
		).toThrow()
	})

	it('accepts false for passed', () => {
		const check = { ...validCriteriaCheck, passed: false }
		expect(criteriaCheckSchema.parse(check)).toEqual(check)
	})
})

// ── verificationIssueSchema ───────────────────────────────────────────────

describe('verificationIssueSchema', () => {
	it('accepts a valid issue', () => {
		expect(verificationIssueSchema.parse(validIssue)).toEqual(validIssue)
	})

	it('accepts optional filePath', () => {
		const issue = { ...validIssue, filePath: 'src/login.ts' }
		expect(verificationIssueSchema.parse(issue)).toEqual(issue)
	})

	it('rejects invalid severity', () => {
		expect(() =>
			verificationIssueSchema.parse({ ...validIssue, severity: 'critical' })
		).toThrow()
	})

	it('accepts all valid severities', () => {
		for (const s of ['blocker', 'warning']) {
			expect(
				verificationIssueSchema.parse({ ...validIssue, severity: s })
			).toBeTruthy()
		}
	})

	it('rejects empty description', () => {
		expect(() =>
			verificationIssueSchema.parse({ ...validIssue, description: '' })
		).toThrow()
	})
})

// ── verificationResultSchema ──────────────────────────────────────────────

describe('verificationResultSchema', () => {
	it('accepts a valid verification result', () => {
		expect(verificationResultSchema.parse(validVerification)).toEqual(validVerification)
	})

	it('rejects empty threadId', () => {
		expect(() =>
			verificationResultSchema.parse({ ...validVerification, threadId: '' })
		).toThrow()
	})

	it('rejects empty planId', () => {
		expect(() =>
			verificationResultSchema.parse({ ...validVerification, planId: '' })
		).toThrow()
	})

	it('rejects invalid result', () => {
		expect(() =>
			verificationResultSchema.parse({ ...validVerification, result: 'skipped' })
		).toThrow()
	})

	it('accepts all valid result values', () => {
		for (const r of ['passed', 'failed']) {
			expect(
				verificationResultSchema.parse({ ...validVerification, result: r })
			).toBeTruthy()
		}
	})

	it('rejects empty summary', () => {
		expect(() =>
			verificationResultSchema.parse({ ...validVerification, summary: '' })
		).toThrow()
	})

	it('accepts empty criteriaResults array', () => {
		const v = { ...validVerification, criteriaResults: [] }
		expect(verificationResultSchema.parse(v)).toEqual(v)
	})

	it('accepts empty issues array', () => {
		const v = { ...validVerification, issues: [] }
		expect(verificationResultSchema.parse(v)).toEqual(v)
	})

	it('propagates nested criteria check validation', () => {
		expect(() =>
			verificationResultSchema.parse({
				...validVerification,
				criteriaResults: [{ ...validCriteriaCheck, criterion: '' }],
			})
		).toThrow()
	})

	it('propagates nested issue validation', () => {
		expect(() =>
			verificationResultSchema.parse({
				...validVerification,
				issues: [{ ...validIssue, description: '' }],
			})
		).toThrow()
	})
})
