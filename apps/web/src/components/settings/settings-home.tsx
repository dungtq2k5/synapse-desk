'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useViewer } from '@/hooks/use-viewer';
import { SettingsFrame, useSettingsSections } from './settings-frame';
import { PageUnavailable } from '@/components/shell/page-unavailable';

/**
 * Opens the first section the viewer can see, or says the area isn't theirs
 * once who they are is known.
 */
export function SettingsHome() {
  const router = useRouter();
  const { query } = useViewer();
  const [first] = useSettingsSections();

  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);

  return query.isSuccess && !first ? (
    <SettingsFrame crumbs={[]}>
      <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
    </SettingsFrame>
  ) : null;
}
