'use client';

import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let intervalId: number | null = null;
let now = Date.now();

function emit() {
  now = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function start() {
  if (intervalId !== null) return;
  intervalId = window.setInterval(emit, 1_000);
}

function stop() {
  window.clearInterval(intervalId as number);
  intervalId = null;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  start();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop();
    }
  };
}

function getSnapshot() {
  return now;
}

function getServerSnapshot() {
  return 0;
}

export function useSharedSecondNow() {
  if (listeners.size === 0 && intervalId === null) {
    now = Date.now();
  }

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
