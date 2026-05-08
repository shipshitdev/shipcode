import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type GhStatusMapping,
  type GhStatusOption,
  type ProjectReadinessItem,
  type ProjectReadinessLabelSync,
  type ProjectReadinessReport,
  parseGithubProjectUrl,
  SHIPCODE_DEFAULT_LABELS,
} from '@shipcode/shared';
import { shellExecEnv } from '../health-check';

const execFileAsync = promisify(execFile);

const TODO_PATTERN = /^(todo|to[- ]?do|backlog|open|triage)$/i;
const IN_PROGRESS_PATTERN = /^(in[- ]?progress|doing|active|agent[- ]?loop|working|started)$/i;
const HUMAN_REVIEW_PATTERN =
  /^(human[- ]?review|review|needs[- ]?(human|review|attention)|waiting)$/i;
const DEFERRED_PATTERN = /^(deferred|postponed|later|someday)$/i;
const DONE_PATTERN = /^(done|closed|completed|shipped|resolved|merged)$/i;

interface ProjectFieldNode {
  __typename?: string;
  name?: string;
  options?: Array<{ id?: string; name?: string; color?: string | null }>;
}

interface ProjectReadinessGraphqlResponse {
  data?: {
    repository?: {
      featureIssueType?: { id?: string; isEnabled?: boolean } | null;
    } | null;
    organization?: ProjectOwnerNode | null;
    user?: ProjectOwnerNode | null;
  };
  errors?: Array<{ message?: string }>;
}

interface ProjectOwnerNode {
  projectV2?: {
    fields?: { nodes?: ProjectFieldNode[] };
  } | null;
}

const FIELD_QUERY_SELECTION = `
  fields(first: 100) {
    nodes {
      __typename
      ... on ProjectV2Field {
        name
      }
      ... on ProjectV2IterationField {
        name
      }
      ... on ProjectV2SingleSelectField {
        name
        options { id name color }
      }
    }
  }
`;

const REPOSITORY_ONLY_QUERY = `
  query($repoOwner: String!, $repoName: String!) {
    repository(owner: $repoOwner, name: $repoName) {
      featureIssueType: issueType(name: "Feature") { id isEnabled }
    }
  }
`;

function buildProjectQuery(isOrg: boolean): string {
  const projectSelection = isOrg
    ? `organization(login: $projectOwner) { projectV2(number: $projectNumber) { ${FIELD_QUERY_SELECTION} } }`
    : `user(login: $projectOwner) { projectV2(number: $projectNumber) { ${FIELD_QUERY_SELECTION} } }`;

  return `
    query(
      $repoOwner: String!
      $repoName: String!
      $projectOwner: String!
      $projectNumber: Int!
    ) {
      repository(owner: $repoOwner, name: $repoName) {
        featureIssueType: issueType(name: "Feature") { id isEnabled }
      }
      ${projectSelection}
    }
  `;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function statusItem(
  key: string,
  kind: ProjectReadinessItem['kind'],
  label: string,
  required: boolean,
  status: ProjectReadinessItem['status'],
  message: string,
  extra: Pick<ProjectReadinessItem, 'present' | 'missing'> = {},
): ProjectReadinessItem {
  return { key, kind, label, required, status, message, ...extra };
}

async function listLabelNames(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'gh',
    ['label', 'list', '--limit', '200', '--json', 'name'],
    { cwd, env: shellExecEnv() },
  );
  const raw = JSON.parse(stdout) as Array<{ name?: string }>;
  return raw.map((label) => label.name).filter((name): name is string => !!name);
}

async function createLabel(
  cwd: string,
  label: { name: string; color: string; description: string },
): Promise<void> {
  try {
    await execFileAsync(
      'gh',
      ['label', 'create', label.name, '--color', label.color, '--description', label.description],
      { cwd, env: shellExecEnv() },
    );
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message ?? '');
    if (/already exists/i.test(stderr)) return;
    throw err;
  }
}

async function ensureLabels(
  cwd: string,
  repair: boolean,
): Promise<{ names: string[]; sync: ProjectReadinessLabelSync }> {
  const names = await listLabelNames(cwd);
  const existing = new Set(names);
  const created: string[] = [];
  const alreadyPresent: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const label of SHIPCODE_DEFAULT_LABELS) {
    if (existing.has(label.name)) {
      alreadyPresent.push(label.name);
      continue;
    }

    if (!repair) {
      failed.push({ name: label.name, error: 'missing' });
      continue;
    }

    try {
      await createLabel(cwd, label);
      created.push(label.name);
      names.push(label.name);
      existing.add(label.name);
    } catch (err) {
      failed.push({ name: label.name, error: String((err as Error).message ?? err) });
    }
  }

  return { names, sync: { created, alreadyPresent, failed } };
}

async function getRepoCoordinates(cwd: string): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFileAsync('gh', ['repo', 'view', '--json', 'owner,name'], {
    cwd,
    env: shellExecEnv(),
  });
  const parsed = JSON.parse(stdout) as { owner?: { login?: string }; name?: string };
  const owner = parsed.owner?.login?.trim();
  const repo = parsed.name?.trim();
  if (!owner || !repo) throw new Error('Failed to resolve repository owner/name via gh repo view');
  return { owner, repo };
}

function graphqlErrors(response: { errors?: Array<{ message?: string }> }): string | null {
  if (!response.errors || response.errors.length === 0) return null;
  return response.errors.map((error) => error.message ?? '<unknown>').join('; ');
}

async function queryProjectReadiness(opts: {
  cwd: string;
  projectUrl: string | null;
  repoOwner: string;
  repoName: string;
}): Promise<ProjectReadinessGraphqlResponse> {
  const parsedProject = parseGithubProjectUrl(opts.projectUrl);
  if (!parsedProject) {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${REPOSITORY_ONLY_QUERY}`,
        '-F',
        `repoOwner=${opts.repoOwner}`,
        '-F',
        `repoName=${opts.repoName}`,
      ],
      { cwd: opts.cwd, env: shellExecEnv() },
    );
    return JSON.parse(stdout) as ProjectReadinessGraphqlResponse;
  }

  const { stdout } = await execFileAsync(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      `query=${buildProjectQuery(parsedProject.ownerType === 'orgs')}`,
      '-F',
      `repoOwner=${opts.repoOwner}`,
      '-F',
      `repoName=${opts.repoName}`,
      '-F',
      `projectOwner=${parsedProject.owner}`,
      '-F',
      `projectNumber=${parsedProject.number}`,
    ],
    { cwd: opts.cwd, env: shellExecEnv() },
  );
  return JSON.parse(stdout) as ProjectReadinessGraphqlResponse;
}

function findField(
  fields: ProjectFieldNode[],
  names: readonly string[],
): ProjectFieldNode | undefined {
  const expected = new Set(names.map(normalizeKey));
  return fields.find((field) => field.name && expected.has(normalizeKey(field.name)));
}

function singleSelectOptions(field: ProjectFieldNode | undefined): string[] {
  if (field?.__typename !== 'ProjectV2SingleSelectField') return [];
  return field.options?.map((option) => option.name).filter((name): name is string => !!name) ?? [];
}

function missingOptions(options: string[], expected: readonly string[]): string[] {
  const present = new Set(options.map(normalizeKey));
  return expected.filter((option) => !present.has(normalizeKey(option)));
}

function colorOf(field: ProjectFieldNode, name: string): string | null {
  return field.options?.find((option) => option.name === name)?.color ?? null;
}

function detectStatusMapping(statusField: ProjectFieldNode | undefined): {
  mapping: GhStatusMapping | null;
  missing: string[];
  options: string[];
} {
  if (!statusField || statusField.__typename !== 'ProjectV2SingleSelectField') {
    return {
      mapping: null,
      missing: ['Todo', 'In Progress', 'Human Review', 'Done', 'Deferred'],
      options: [],
    };
  }

  const options = singleSelectOptions(statusField);
  let todo: GhStatusOption | null = null;
  let inProgress: GhStatusOption | null = null;
  let humanReview: GhStatusOption | null = null;
  let deferred: GhStatusOption | null = null;
  let done: GhStatusOption | null = null;

  for (const option of options) {
    if (!todo && TODO_PATTERN.test(option))
      todo = { name: option, color: colorOf(statusField, option) };
    else if (!inProgress && IN_PROGRESS_PATTERN.test(option)) {
      inProgress = { name: option, color: colorOf(statusField, option) };
    } else if (!humanReview && HUMAN_REVIEW_PATTERN.test(option)) {
      humanReview = { name: option, color: colorOf(statusField, option) };
    } else if (!deferred && DEFERRED_PATTERN.test(option)) {
      deferred = { name: option, color: colorOf(statusField, option) };
    } else if (!done && DONE_PATTERN.test(option)) {
      done = { name: option, color: colorOf(statusField, option) };
    }
  }

  const missing: string[] = [];
  if (!todo) missing.push('Todo');
  if (!inProgress) missing.push('In Progress');
  if (!humanReview) missing.push('Human Review');
  if (!done) missing.push('Done');
  if (!deferred) missing.push('Deferred');
  return { mapping: { todo, inProgress, humanReview, deferred, done }, missing, options };
}

function addFieldReadinessItems(
  items: ProjectReadinessItem[],
  fields: ProjectFieldNode[],
): GhStatusMapping | null {
  const statusField = findField(fields, ['Status']);
  const status = detectStatusMapping(statusField);
  if (!statusField) {
    items.push(
      statusItem(
        'project-field:status',
        'project-field',
        'Status',
        true,
        'missing',
        'Add a GitHub Projects single-select field named "Status".',
        { missing: status.missing },
      ),
    );
  } else if (status.missing.length > 0) {
    items.push(
      statusItem(
        'project-field:status',
        'project-field',
        'Status',
        true,
        'missing',
        'Status exists, but ShipCode cannot map every board column.',
        { present: status.options, missing: status.missing },
      ),
    );
  } else {
    items.push(
      statusItem(
        'project-field:status',
        'project-field',
        'Status',
        true,
        'ready',
        'Status maps to ShipCode board columns.',
        { present: status.options },
      ),
    );
  }

  const requirements: Array<{
    key: string;
    label: string;
    names: readonly string[];
    options: readonly string[];
  }> = [
    { key: 'priority', label: 'Priority', names: ['Priority'], options: ['P0', 'P1', 'P2', 'P3'] },
    {
      key: 'complexity',
      label: 'Complexity',
      names: ['Complexity'],
      options: ['Low', 'Medium', 'High'],
    },
    {
      key: 'blast-radius',
      label: 'Blast radius',
      names: ['Blast radius', 'Blast Radius'],
      options: ['Contained', 'Cross-Package', 'Cross-App', 'Infra'],
    },
  ];

  for (const requirement of requirements) {
    const field = findField(fields, requirement.names);
    const options = singleSelectOptions(field);
    if (!field) {
      items.push(
        statusItem(
          `project-field:${requirement.key}`,
          'project-field',
          requirement.label,
          true,
          'missing',
          `Add a GitHub Projects single-select field named "${requirement.label}".`,
          { missing: [...requirement.options] },
        ),
      );
      continue;
    }

    if (field.__typename !== 'ProjectV2SingleSelectField') {
      items.push(
        statusItem(
          `project-field:${requirement.key}`,
          'project-field',
          requirement.label,
          true,
          'missing',
          `"${requirement.label}" must be a single-select field.`,
          { missing: [...requirement.options] },
        ),
      );
      continue;
    }

    const missing = missingOptions(options, requirement.options);
    items.push(
      statusItem(
        `project-field:${requirement.key}`,
        'project-field',
        requirement.label,
        true,
        missing.length === 0 ? 'ready' : 'missing',
        missing.length === 0
          ? `${requirement.label} has the expected options.`
          : `${requirement.label} is missing options ShipCode writes.`,
        { present: options, missing },
      ),
    );
  }

  const areaField = findField(fields, ['Area', 'Component']);
  items.push(
    statusItem(
      'project-field:area-component',
      'project-field',
      'Area or Component',
      false,
      areaField ? 'ready' : 'warning',
      areaField
        ? `Found "${areaField.name}" for product taxonomy.`
        : 'Optional product taxonomy should live in an Area or Component field, not labels.',
      areaField ? { present: [areaField.name ?? ''] } : { missing: ['Area or Component'] },
    ),
  );

  return status.mapping;
}

export async function checkProjectReadiness(opts: {
  cwd: string;
  projectUrl?: string | null;
  repairLabels?: boolean;
  onWarn?: (message: string, err?: unknown) => void;
}): Promise<ProjectReadinessReport> {
  const items: ProjectReadinessItem[] = [];
  let labelNames: string[] = [];
  let labelSync: ProjectReadinessLabelSync = {
    created: [],
    alreadyPresent: [],
    failed: [],
  };
  let statusMapping: GhStatusMapping | null = null;

  try {
    const result = await ensureLabels(opts.cwd, opts.repairLabels ?? true);
    labelNames = result.names;
    labelSync = result.sync;
    items.push(
      statusItem(
        'shipcode-labels',
        'labels',
        'ShipCode labels',
        true,
        labelSync.failed.length === 0 ? 'ready' : 'error',
        labelSync.failed.length === 0
          ? labelSync.created.length === 0
            ? 'All ShipCode labels are present.'
            : `Created ${labelSync.created.length} missing ShipCode label(s).`
          : `Could not create ${labelSync.failed.length} ShipCode label(s).`,
        {
          present: [...labelSync.alreadyPresent, ...labelSync.created],
          missing: labelSync.failed.map((failed) => failed.name),
        },
      ),
    );
  } catch (err) {
    opts.onWarn?.('[project-readiness] label check failed', err);
    items.push(
      statusItem(
        'shipcode-labels',
        'labels',
        'ShipCode labels',
        true,
        'error',
        'Could not inspect or repair ShipCode labels.',
      ),
    );
  }

  let repoOwner: string;
  let repoName: string;
  try {
    const repo = await getRepoCoordinates(opts.cwd);
    repoOwner = repo.owner;
    repoName = repo.repo;
  } catch (err) {
    opts.onWarn?.('[project-readiness] repo coordinate lookup failed', err);
    items.push(
      statusItem(
        'github-repo',
        'github-project',
        'GitHub repository',
        true,
        'error',
        'Could not resolve the GitHub repository for this folder.',
      ),
    );
    return finishReport(opts.projectUrl ?? null, labelSync, labelNames, statusMapping, items);
  }

  const projectUrl = opts.projectUrl?.trim() || null;
  const parsedProject = parseGithubProjectUrl(projectUrl);
  if (!parsedProject) {
    items.push(
      statusItem(
        'github-project-url',
        'github-project',
        'GitHub Projects board',
        true,
        'missing',
        'Set a GitHub Projects v2 board URL for this repository.',
      ),
    );
  } else {
    items.push(
      statusItem(
        'github-project-url',
        'github-project',
        'GitHub Projects board',
        true,
        'ready',
        'GitHub Projects v2 board URL is configured.',
      ),
    );
  }

  let response: ProjectReadinessGraphqlResponse;
  try {
    response = await queryProjectReadiness({
      cwd: opts.cwd,
      projectUrl,
      repoOwner,
      repoName,
    });
  } catch (err) {
    opts.onWarn?.('[project-readiness] GraphQL query failed', err);
    items.push(
      statusItem(
        'github-project-query',
        'github-project',
        'GitHub project schema',
        true,
        'error',
        'Could not inspect GitHub Project fields. Refresh gh auth with project scope.',
      ),
    );
    return finishReport(projectUrl, labelSync, labelNames, statusMapping, items);
  }

  const errors = graphqlErrors(response);
  if (errors) {
    items.push(
      statusItem(
        'github-project-query',
        'github-project',
        'GitHub project schema',
        true,
        'error',
        `GitHub returned GraphQL errors: ${errors}`,
      ),
    );
    return finishReport(projectUrl, labelSync, labelNames, statusMapping, items);
  }

  const issueType = response.data?.repository?.featureIssueType;
  if (issueType?.id && issueType.isEnabled !== false) {
    items.push(
      statusItem(
        'issue-type:feature',
        'issue-type',
        'Feature issue type',
        true,
        'ready',
        'Native GitHub issue type "Feature" is available.',
      ),
    );
  } else {
    items.push(
      statusItem(
        'issue-type:feature',
        'issue-type',
        'Feature issue type',
        true,
        'missing',
        'Enable or create the native GitHub issue type "Feature".',
        { missing: ['Feature'] },
      ),
    );
  }

  if (parsedProject) {
    const project =
      parsedProject.ownerType === 'orgs'
        ? response.data?.organization?.projectV2
        : response.data?.user?.projectV2;
    if (!project) {
      items.push(
        statusItem(
          'github-project-access',
          'github-project',
          'GitHub project access',
          true,
          'error',
          'GitHub Project board was not found or is not accessible.',
        ),
      );
    } else {
      statusMapping = addFieldReadinessItems(items, project.fields?.nodes ?? []);
    }
  }

  return finishReport(projectUrl, labelSync, labelNames, statusMapping, items);
}

function finishReport(
  projectUrl: string | null,
  labelSync: ProjectReadinessLabelSync,
  labelNames: string[],
  statusMapping: GhStatusMapping | null,
  items: ProjectReadinessItem[],
): ProjectReadinessReport {
  const ok = items.every((item) => !item.required || item.status === 'ready');
  return {
    ok,
    checkedAt: new Date().toISOString(),
    projectUrl,
    labelSync,
    labelNames: Array.from(new Set(labelNames)).sort(),
    statusMapping,
    items,
  };
}
