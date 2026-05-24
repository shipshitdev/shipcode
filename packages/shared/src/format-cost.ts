export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}
