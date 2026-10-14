'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Asks before leaving a page with unsaved changes: an in-app link waits for a
 * confirmation (`pending` is where it was going), and closing or reloading
 * the tab gets the browser's own prompt. The App Router has no navigation
 * hook to cancel, so links are caught as they're clicked.
 */
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;

    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') {
        return;
      }
      const to = new URL(link.href);
      if (to.origin !== location.origin || to.href === location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(to.pathname + to.search + to.hash);
    };

    globalThis.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      globalThis.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);

  return {
    pending,
    stay: () => setPending(null),
    /** Goes where the link was going, the changes left behind. */
    leave: () => {
      if (pending) router.push(pending);
      setPending(null);
    },
  };
}
