const ESC = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)`,
  'g',
);

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}
