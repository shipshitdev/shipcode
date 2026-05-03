const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\](?:[^${ESC}${BEL}]|${ESC}(?!\\\\))*?(?:${BEL}|${ESC}\\\\)`,
  'g',
);

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}
