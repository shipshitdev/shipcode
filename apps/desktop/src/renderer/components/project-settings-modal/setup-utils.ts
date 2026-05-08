import type { RepoSetupEnvFile, RuntimeQaConfig } from '@shipcode/shared';

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

export function runtimeQaCommandsToText(runtimeQa?: RuntimeQaConfig): string {
  return commandsToText(runtimeQa?.testCommands ?? []);
}

export function buildRuntimeQaConfig({
  serverCommand,
  readinessUrl,
  startupTimeoutMs,
  portEnvVar,
  testCommandsText,
  discoverAgentTests,
}: {
  serverCommand: string;
  readinessUrl: string;
  startupTimeoutMs: number;
  portEnvVar: string;
  testCommandsText: string;
  discoverAgentTests: boolean;
}): RuntimeQaConfig | undefined {
  const serverCommandValue = serverCommand.trim();
  const readinessUrlValue = readinessUrl.trim();
  const testCommands = textToCommands(testCommandsText);
  const hasServer = serverCommandValue.length > 0 || readinessUrlValue.length > 0;

  if (!hasServer && testCommands.length === 0 && discoverAgentTests) {
    return undefined;
  }

  return {
    ...(hasServer
      ? {
          server: {
            command: serverCommandValue,
            readinessUrl: readinessUrlValue,
            startupTimeoutMs,
            portEnvVar: portEnvVar.trim() || 'PORT',
          },
        }
      : {}),
    testCommands,
    discoverAgentTests,
  };
}

export function normalizeEnvFiles(envFiles: RepoSetupEnvFile[]): LocalEnvFile[] {
  return envFiles.map((file) => ({
    id: makeEnvFileId(),
    source: file.source,
    target: file.target,
    required: file.required,
  }));
}
