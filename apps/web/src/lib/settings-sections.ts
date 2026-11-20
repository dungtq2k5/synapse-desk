import type { CurrentUserResponseDtoPermissionCodesItem as PermissionCode } from '@synapsedesk/api-client';

/** A Settings section: where it is, and what reads it. */
export type SettingsSection = {
  label: string;
  href: string;
  /** Holding any of these shows the section. */
  read: PermissionCode[];
};

/**
 * The Settings area's sections, in order. Plain data, so the server's
 * `/settings` redirect and the browser's nav read the same list.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    label: 'Organization',
    href: '/settings/organization',
    read: ['organization.read'],
  },
  { label: 'People', href: '/settings/people', read: ['user.read'] },
  {
    label: 'Departments',
    href: '/settings/departments',
    read: ['department.read'],
  },
  { label: 'Roles', href: '/settings/roles', read: ['role.read'] },
  {
    label: 'Webhooks',
    href: '/settings/webhooks',
    read: ['organization.read'],
  },
  { label: 'Audit log', href: '/settings/audit-log', read: ['audit.read'] },
  {
    label: 'Billing',
    href: '/settings/billing',
    read: ['organization.read'],
  },
];

/**
 * The sections someone holding these codes may open, in order.
 *
 * @example settingsSections(['user.read'])[0].href // '/settings/people'
 */
export function settingsSections(codes: readonly string[]): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) =>
    section.read.some((code) => codes.includes(code)),
  );
}
