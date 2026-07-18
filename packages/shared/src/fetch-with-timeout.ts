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

  const controller = new AbortController();
  const cleanupCallbacks: Array<() => void> = [];

  for (const signal of [init.signal, outerSignal]) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    cleanupCallbacks.push(() => signal.removeEventListener('abort', abort));
  }

  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      ),
    timeoutMs,
  );

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    for (const cleanup of cleanupCallbacks) cleanup();
  }
}
