const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export async function fetchWithTimeout(
  url: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<Response> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer between 0 and ${MAX_TIMEOUT_MS}`);
  }

  const signals = [init.signal, outerSignal, AbortSignal.timeout(timeoutMs)].filter(
    (signal): signal is AbortSignal => signal != null,
  );
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  return fetch(url, { ...init, signal });
}
