import type { Metadata } from 'next';
import { SettingsHome } from '@/components/settings/settings-home';

export const metadata: Metadata = { title: 'Settings · SynapseDesk' };

/** `/settings`: the first section the viewer can see. */
export default function SettingsPage() {
  return <SettingsHome />;
}
