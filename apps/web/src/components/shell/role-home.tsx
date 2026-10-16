'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useViewer } from '@/hooks/use-viewer';

/** The root, decided in the browser: Tickets for an agent, Ask for anyone else. */
export function RoleHome() {
  const { query, isAgent } = useViewer();
  const router = useRouter();
  useEffect(() => {
    if (query.isSuccess) router.replace(isAgent ? '/tickets' : '/ask');
  }, [query.isSuccess, isAgent, router]);
  return null;
}
