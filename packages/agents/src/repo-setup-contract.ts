import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_SETUP_CONTRACT_FILE,
  type RepoSetupContract,
  repoSetupContractSchema,
} from '@shipcode/shared';

export interface LoadedRepoSetupContract {
  path: string;
  contract: RepoSetupContract;
}

export function loadRepoSetupContract(projectPath: string): LoadedRepoSetupContract | null {
  const contractPath = join(projectPath, REPO_SETUP_CONTRACT_FILE);
  if (!existsSync(contractPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(contractPath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid repo setup contract at ${REPO_SETUP_CONTRACT_FILE}: ${message}`);
  }

  const parsed = repoSetupContractSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid repo setup contract at ${REPO_SETUP_CONTRACT_FILE}: ${reason}`);
  }

  return {
    path: contractPath,
    contract: parsed.data,
  };
}
