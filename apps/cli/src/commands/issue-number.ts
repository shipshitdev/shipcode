export function parseIssueNumberOrExit(issueNumber: string): number {
  const num = Number.parseInt(issueNumber, 10);
  if (Number.isNaN(num)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }
  return num;
}
