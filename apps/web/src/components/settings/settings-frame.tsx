'use client';

import type { CurrentUserResponseDtoPermissionCodesItem as PermissionCode } from '@synapsedesk/api-client';
import {
  Building2Icon,
  CreditCardIcon,
  NetworkIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
  WebhookIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewer } from '@/hooks/use-viewer';
import { cn } from '@/lib/utils';

type Section = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Holding any of these shows the section. */
  read: PermissionCode[];
};

/** The Settings area's sections, in order, each with what reads it. */
export const SETTINGS_SECTIONS: Section[] = [
  {
    label: 'Organization',
    href: '/settings/organization',
    icon: Building2Icon,
    read: ['organization.read'],
  },
  {
    label: 'People',
    href: '/settings/people',
    icon: UsersIcon,
    read: ['user.read'],
  },
  {
    label: 'Departments',
    href: '/settings/departments',
    icon: NetworkIcon,
    read: ['department.read'],
  },
  {
    label: 'Roles',
    href: '/settings/roles',
    icon: ShieldIcon,
    read: ['role.read'],
  },
  {
    label: 'Webhooks',
    href: '/settings/webhooks',
    icon: WebhookIcon,
    read: ['organization.read'],
  },
  {
    label: 'Audit log',
    href: '/settings/audit-log',
    icon: ScrollTextIcon,
    read: ['audit.read'],
  },
  {
    label: 'Billing',
    href: '/settings/billing',
    icon: CreditCardIcon,
    read: ['organization.read'],
  },
];

/** The sections someone holding these codes may open, in order. */
export function useSettingsSections(): Section[] {
  const { can } = useViewer();
  return SETTINGS_SECTIONS.filter((section) => section.read.some(can));
}

/**
 * The left column on a wide screen; a row of pill links that scrolls
 * sideways under 768 px, keeping the current one in view. Links, not tabs:
 * each section is its own route.
 */
function SettingsNav() {
  const pathname = usePathname();
  const sections = useSettingsSections();
  const current = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <nav aria-label="Settings" className="md:w-50 md:shrink-0">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
        {sections.map((section) => {
          const active = pathname.startsWith(section.href);
          return (
            <li key={section.href} className="shrink-0">
              <Link
                ref={active ? current : undefined}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full border px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:rounded-md md:border-transparent md:px-2',
                  active
                    ? 'border-transparent bg-accent font-medium text-accent-foreground'
                    : 'border-input hover:bg-accent/50',
                )}
              >
                <section.icon
                  aria-hidden
                  className={cn('size-4', !active && 'text-muted-foreground')}
                />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A Settings page: the bar with its crumbs, the section list, then the page.
 *
 * @example <SettingsFrame crumbs={[{ label: 'People' }]}>…</SettingsFrame>
 */
export function SettingsFrame({
  crumbs,
  children,
}: {
  /** After "Settings": the section, then the item if any. */
  crumbs: { label: string; href?: string }[];
  children: ReactNode;
}) {
  return (
    <>
      <AppHeader
        crumbs={[{ label: 'Settings', href: '/settings' }, ...crumbs]}
      />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-6 p-4 outline-none md:flex-row md:gap-8 md:p-6"
      >
        <SettingsNav />
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </main>
    </>
  );
}

/**
 * A page's heading: the h1, a line under it, and its main action.
 *
 * @example <PageHeading title="People" description="…" action={<InviteButton />} />
 */
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight break-words">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * A list on its way: its shape in gray, said once to a screen reader.
 *
 * @example <Loading what="people" />
 */
export function Loading({
  what,
  className,
}: {
  what: string;
  className?: string;
}) {
  return (
    <div aria-busy>
      <span className="sr-only" role="status">
        Loading {what}
      </span>
      <Skeleton className={cn('h-80 w-full', className)} />
    </div>
  );
}

/**
 * A list or card that didn't load: the deck's words, with Try again.
 *
 * @example <LoadError what="people" onRetry={() => void people.refetch()} />
 */
export function LoadError({
  what,
  onRetry,
}: {
  /** "people", "the audit log". */
  what: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border px-6 py-12 text-center"
    >
      <h2 className="font-medium">Couldn’t load {what}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong on our side. Try again in a moment.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
