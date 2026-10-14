'use client';

import { useViewer } from '@/hooks/use-viewer';
import { ProfileForm } from './profile-form';

/** The profile form, once the signed-in user is known (the layout fetched it). */
export function ProfileView() {
  const { user } = useViewer();
  return user ? <ProfileForm user={user} /> : null;
}
