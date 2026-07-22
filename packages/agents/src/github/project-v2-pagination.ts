import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseGithubProjectUrl, SHELL_EXEC_TIMEOUT_MS } from '@shipcode/shared';

const execFileAsync = promisify(execFile);

export interface ProjectV2FieldValueNode {
  __typename?: string;
  name?: string;
  field?: { name?: string };
}

export interface ProjectV2ItemNode {
  isArchived?: boolean;
  content?: {
    __typename?: string;
    number?: number;
    issueType?: { name?: string | null } | null;
    repository?: { nameWithOwner?: string };
  };
  fieldValues?: { nodes?: ProjectV2FieldValueNode[] };
}

interface ProjectV2Response {
  data?: {
    organization?: { projectV2?: ProjectV2Node | null } | null;
    user?: { projectV2?: ProjectV2Node | null } | null;
  };
  errors?: Array<{ message?: string }>;
}

interface ProjectV2Node {
  items?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: ProjectV2ItemNode[];
  };
}

export interface PaginateProjectV2ItemsOptions {
  cwd: string;
  projectUrl: string;
  /** Prefix used for caller-specific diagnostics, without square brackets. */
  warningPrefix: string;
  /** Noun used in the page-cap warning, such as "priority" or "status". */
  syncName: string;
  /** Hard cap on pages. Default 50 (5000 items). */
  maxPages?: number;
  onWarn?: (message: string, err?: unknown) => void;
}

const ITEM_SELECTION = `
  items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      isArchived
      content {
        __typename
        ... on Issue {
          number
          issueType { name }
          repository { nameWithOwner }
        }
      }
      fieldValues(first: 50) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field { ... on ProjectV2SingleSelectField { name } }
          }
        }
      }
    }
  }
`;

function buildQuery(isOrganization: boolean): string {
  const ownerSelection = isOrganization
    ? `organization(login: $login) { projectV2(number: $number) { ${ITEM_SELECTION} } }`
    : `user(login: $login) { projectV2(number: $number) { ${ITEM_SELECTION} } }`;

  return `
    query($login: String!, $number: Int!, $cursor: String) {
      ${ownerSelection}
    }
  `;
}

function isMissingScopeError(message: string): boolean {
  return /insufficient_scopes|read:project|missing.*scope|requires.*scope/i.test(message);
}

/**
 * Read every item from a GitHub Projects v2 board while preserving any pages
 * collected before a best-effort transport or response failure.
 */
export async function paginateProjectV2Items(
  opts: PaginateProjectV2ItemsOptions,
): Promise<ProjectV2ItemNode[]> {
  const items: ProjectV2ItemNode[] = [];
  const parsed = parseGithubProjectUrl(opts.projectUrl);
  const prefix = `[${opts.warningPrefix}]`;
  if (!parsed) {
    opts.onWarn?.(`${prefix} unparseable project URL: ${opts.projectUrl}`);
    return items;
  }

  const isOrganization = parsed.ownerType === 'orgs';
  const query = buildQuery(isOrganization);
  const maxPages = opts.maxPages ?? 50;
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `login=${parsed.owner}`,
      '-F',
      `number=${parsed.number}`,
      '-F',
      `cursor=${cursor ?? 'null'}`,
    ];

    let stdout: string;
    try {
      const exec = await execFileAsync('gh', args, {
        cwd: opts.cwd,
        timeout: SHELL_EXEC_TIMEOUT_MS,
      });
      stdout = exec.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr ?? '')
          : '';
      const blob = `${message}\n${stderr}`;
      if (isMissingScopeError(blob)) {
        opts.onWarn?.(
          `${prefix} missing read:project scope — run \`gh auth refresh -s read:project\` to enable ${opts.syncName} sync`,
          err,
        );
      } else {
        opts.onWarn?.(`${prefix} gh api graphql failed`, err);
      }
      return items;
    }

    let response: ProjectV2Response;
    try {
      response = JSON.parse(stdout) as ProjectV2Response;
    } catch (err) {
      opts.onWarn?.(`${prefix} failed to parse GraphQL response`, err);
      return items;
    }

    if (response.errors && response.errors.length > 0) {
      const messages = response.errors.map((error) => error.message ?? '<unknown>').join('; ');
      opts.onWarn?.(`${prefix} GraphQL errors: ${messages}`);
      return items;
    }

    const project = isOrganization
      ? response.data?.organization?.projectV2
      : response.data?.user?.projectV2;
    if (!project) {
      opts.onWarn?.(`${prefix} project not found: ${opts.projectUrl}`);
      return items;
    }

    items.push(...(project.items?.nodes ?? []));

    const pageInfo = project.items?.pageInfo;
    if (!pageInfo?.hasNextPage) return items;
    if (!pageInfo.endCursor) {
      opts.onWarn?.(
        `${prefix} pagination response hasNextPage=true without an endCursor`,
      );
      return items;
    }
    cursor = pageInfo.endCursor;
  }

  opts.onWarn?.(`${prefix} hit page cap of ${maxPages}; truncating ${opts.syncName} sync`);
  return items;
}
