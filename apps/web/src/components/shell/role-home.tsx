'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useViewer } from '@/hooks/use-viewer';
import { home } from '@/lib/home';

/**
 * The root, decided in the browser: the console for a Super Admin, Tickets
 * for an agent, Ask for anyone else.
 */
export function RoleHome() {
  const { query, isAgent, isSuperAdmin } = useViewer();
  const router = useRouter();
  useEffect(() => {
    if (query.isSuccess) router.replace(home(isSuperAdmin, isAgent));
  }, [query.isSuccess, isAgent, isSuperAdmin, router]);
  return null;
}
