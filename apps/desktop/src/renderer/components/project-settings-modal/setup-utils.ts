import type { RepoSetupEnvFile } from '@shipcode/shared';

export type LocalEnvFile = RepoSetupEnvFile & { id: string };

export function makeEnvFileId(): string {
  return `env-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function commandsToText(commands: string[]): string {
  return commands.join('\n');
}

export function textToCommands(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeEnvFiles(envFiles: RepoSetupEnvFile[]): LocalEnvFile[] {
  return envFiles.map((file) => ({
    id: makeEnvFileId(),
    source: file.source,
    target: file.target,
    required: file.required,
  }));
}
