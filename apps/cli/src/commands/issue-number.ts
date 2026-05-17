export function parseIssueNumberOrExit(issueNumber: string): number {
  const trimmed = issueNumber.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }
  return num;
}
