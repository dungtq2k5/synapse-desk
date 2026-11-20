'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * An export this browser asked for, kept under `key` so it's still waiting
 * after the viewer leaves and comes back, in this tab or another. A blocked
 * store only means it isn't kept.
 *
 * @example const [requested, setRequested] = useStoredExport<Requested>('synapsedesk.audit-export');
 */
export function useStoredExport<T>(
  key: string,
): [T | null, (next: T | null) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      globalThis.addEventListener('storage', onChange);
      globalThis.addEventListener(key, onChange);
      return () => {
        globalThis.removeEventListener('storage', onChange);
        globalThis.removeEventListener(key, onChange);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [raw]);
  const set = (next: T | null) => {
    try {
      if (next) globalThis.localStorage.setItem(key, JSON.stringify(next));
      else globalThis.localStorage.removeItem(key);
    } catch {
      // Not kept; the card goes with the page.
    }
    // Same-tab readers are told; other tabs hear `storage`.
    globalThis.dispatchEvent(new Event(key));
  };
  return [value, set];
}

function read(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}
