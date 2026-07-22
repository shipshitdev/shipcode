import { clampError } from '@shipcode/shared';

export const IPC_INPUT_LIMITS = {
  maxArrayItems: 10_000,
  maxDepth: 20,
  maxKeyBytes: 256,
  maxNodes: 20_000,
  maxObjectProperties: 1_000,
  maxStringBytes: 512 * 1024,
  maxTotalBytes: 1024 * 1024,
} as const;

const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

interface ValidationBudget {
  bytes: number;
  nodes: number;
  seen: WeakSet<object>;
}

function invalidInput(channel: string, reason: string): never {
  throw new Error(clampError(`Invalid IPC input for ${channel}: ${reason}`));
}

function addBytes(channel: string, budget: ValidationBudget, bytes: number): void {
  budget.bytes += bytes;
  if (budget.bytes > IPC_INPUT_LIMITS.maxTotalBytes) {
    invalidInput(channel, `payload exceeds ${IPC_INPUT_LIMITS.maxTotalBytes} bytes`);
  }
}

function addNode(channel: string, budget: ValidationBudget): void {
  budget.nodes += 1;
  if (budget.nodes > IPC_INPUT_LIMITS.maxNodes) {
    invalidInput(channel, `payload exceeds ${IPC_INPUT_LIMITS.maxNodes} values`);
  }
}

function validateStructuredValue(
  channel: string,
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget,
): void {
  if (depth > IPC_INPUT_LIMITS.maxDepth) {
    invalidInput(channel, `${path} exceeds maximum nesting depth`);
  }

  addNode(channel, budget);

  if (value === null || value === undefined) {
    addBytes(channel, budget, 4);
    return;
  }

  switch (typeof value) {
    case 'boolean':
      addBytes(channel, budget, 1);
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        invalidInput(channel, `${path} must be a finite number`);
      }
      addBytes(channel, budget, 8);
      return;
    case 'string': {
      const bytes = Buffer.byteLength(value, 'utf8');
      if (bytes > IPC_INPUT_LIMITS.maxStringBytes) {
        invalidInput(channel, `${path} exceeds ${IPC_INPUT_LIMITS.maxStringBytes} bytes`);
      }
      addBytes(channel, budget, bytes);
      return;
    }
    case 'bigint':
    case 'function':
    case 'symbol':
      invalidInput(channel, `${path} contains unsupported ${typeof value} data`);
  }

  if (budget.seen.has(value)) {
    invalidInput(channel, `${path} contains a circular reference`);
  }
  budget.seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > IPC_INPUT_LIMITS.maxArrayItems) {
      invalidInput(channel, `${path} exceeds ${IPC_INPUT_LIMITS.maxArrayItems} array items`);
    }
    addBytes(channel, budget, value.length);
    for (let index = 0; index < value.length; index += 1) {
      validateStructuredValue(channel, value[index], `${path}[${index}]`, depth + 1, budget);
    }
    budget.seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalidInput(channel, `${path} must be a plain object`);
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length > IPC_INPUT_LIMITS.maxObjectProperties) {
    invalidInput(
      channel,
      `${path} exceeds ${IPC_INPUT_LIMITS.maxObjectProperties} object properties`,
    );
  }

  for (const key of keys) {
    if (typeof key === 'symbol') {
      invalidInput(channel, `${path} contains symbol properties`);
    }
    if (BLOCKED_PROPERTY_NAMES.has(key)) {
      invalidInput(channel, `${path} contains blocked property ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      invalidInput(channel, `${path}.${key} could not be inspected`);
    }
    if (!('value' in descriptor)) {
      invalidInput(channel, `${path}.${key} must not use an accessor`);
    }

    const keyBytes = Buffer.byteLength(key, 'utf8');
    if (keyBytes > IPC_INPUT_LIMITS.maxKeyBytes) {
      invalidInput(channel, `${path} contains an oversized property name`);
    }
    addBytes(channel, budget, keyBytes);
    validateStructuredValue(channel, descriptor.value, `${path}.${key}`, depth + 1, budget);
  }

  budget.seen.delete(value);
}

/**
 * Enforces the transport-level contract for values received from the renderer.
 * Channel-specific handlers remain responsible for domain validation such as
 * enum membership, entity existence, authorization, and filesystem safety.
 */
export function validateIpcInvokeArgs(channel: string, args: unknown[]): void {
  if (args.length > 1) {
    invalidInput(channel, 'expected at most one argument object');
  }

  const payload = args[0];
  if (payload === undefined) return;

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    invalidInput(channel, 'expected a plain argument object');
  }

  validateStructuredValue(channel, payload, 'args', 0, {
    bytes: 0,
    nodes: 0,
    seen: new WeakSet(),
  });
}
