interface CrossCodeAPI {
  invoke: <T>(channel: string, args?: unknown) => Promise<T>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

declare global {
  interface Window {
    crosscode: CrossCodeAPI
  }
}

export {}
