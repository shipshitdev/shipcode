import type { ContextFileInfo, ContextGeneratorCli } from '@shipcode/shared';
import {
  generateMemoryFiles,
  listMemoryFiles,
  type MemoryGenerateResult,
  readMemoryFile,
} from './memory-generator';

export type ContextGenerateResult = MemoryGenerateResult;

export function listContextFiles(projectPath: string): ContextFileInfo[] {
  return listMemoryFiles(projectPath);
}

export function readContextFile(projectPath: string, name: string): string | null {
  return readMemoryFile(projectPath, name);
}

export function generateContextFiles(
  projectPath: string,
  cli: ContextGeneratorCli = 'claude',
): Promise<ContextGenerateResult> {
  return generateMemoryFiles(projectPath, cli);
}
