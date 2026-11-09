import * as React from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * Whether the person asked for reduced motion. `true` while rendering on the
 * server, so nothing that moves is in the first HTML; it appears after
 * hydration only where motion is allowed.
 */
export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}
