'use client';

import {
  getDepartmentsControllerListMembersV1QueryOptions,
  useInvitationsControllerListV1,
  useOrganizationsControllerGetV1,
  useRolesControllerListV1,
  useUserAdminControllerListV1,
  type RoleResponseDto,
  type UserResponseDto,
} from '@synapsedesk/api-client';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { UserAvatar } from '@/components/shell/user-avatar';
import { useViewer } from '@/hooks/use-viewer';
import { cn } from '@/lib/utils';
import { PageHeading } from '../settings-frame';

/** Every role the organization can give, system roles first, by id. */
export function useRoles(): {
  roles: RoleResponseDto[];
  names: ReadonlyMap<string, string>;
  /** False until the first answer. */
  loaded: boolean;
} {
  const { can } = useViewer();
  const query = useRolesControllerListV1(
    { limit: 100, includeSystem: true, sortBy: 'name', sortOrder: 'ASC' },
    {
      query: {
        enabled: can('role.read') || can('user.read'),
        staleTime: 60_000,
      },
    },
  );
  return useMemo(() => {
    const roles = [...(query.data?.data?.items ?? [])].sort(
      (a, b) => Number(b.isSystemRole) - Number(a.isSystemRole),
    );
    return {
      roles,
      names: new Map(roles.map((role) => [role.id, role.name])),
      loaded: query.data !== undefined,
    };
  }, [query.data]);
}

/** Refetches every people, invitation, role and department view after a change. */
export function usePeopleCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        /^\/api\/v1\/(users|roles|departments|organizations\/current\/usage)/.test(
          queryKey[0],
        ),
    });
}

/** The organization's name, for sentences that say it. */
export function useOrganizationName(): string {
  return useOrganizationsControllerGetV1().data?.data?.name ?? '';
}

/**
 * People's heading: the h1, its line, Invite, and the two tabs. Each tab is
 * its own route, so they're links marked `aria-current`, not a tablist.
 */
export function PeopleHeader({
  tab,
  action,
}: {
  tab: 'members' | 'invitations';
  action?: ReactNode;
}) {
  const { can } = useViewer();
  const organization = useOrganizationName();
  const members = useUserAdminControllerListV1({ limit: 1 });
  const pending = useInvitationsControllerListV1(
    { limit: 1, status: 'PENDING' },
    { query: { enabled: can('user.read') } },
  );
  const tabs = [
    {
      key: 'members',
      href: '/settings/people',
      label: 'Members',
      count: members.data?.data?.meta.totalItems,
    },
    {
      key: 'invitations',
      href: '/settings/people/invitations',
      label: 'Invitations',
      count: pending.data?.data?.meta.totalItems,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title="People"
        description={
          organization
            ? `Everyone in ${organization}, and who’s been invited.`
            : undefined
        }
        action={action}
      />
      <nav aria-label="People">
        <ul className="inline-flex h-9 w-full max-w-80 items-center rounded-lg bg-muted p-0.75">
          {tabs.map((item) => (
            <li key={item.key} className="h-full min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={item.key === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex h-full w-full items-center justify-center overflow-hidden rounded-md border border-transparent px-2 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  item.key === tab &&
                    'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30',
                )}
              >
                {item.count === undefined
                  ? item.label
                  : `${item.label} (${item.count})`}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** A person: avatar, the name linking to their page (not when deleted), email. */
export function PersonCell({
  user,
  deleted,
}: {
  user: Pick<UserResponseDto, 'id' | 'fullName' | 'email' | 'avatarUrl'>;
  deleted?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar
        name={user.fullName}
        src={user.avatarUrl}
        className="size-8 text-xs"
      />
      <div className="flex min-w-0 flex-col">
        {deleted ? (
          <span className="truncate font-medium">{user.fullName}</span>
        ) : (
          <Link
            href={`/settings/people/${user.id}`}
            className="truncate font-medium text-primary underline-offset-4 hover:underline"
          >
            {user.fullName}
          </Link>
        )}
        <span className="truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </div>
    </div>
  );
}

/**
 * Which of someone's departments is their primary, and each membership:
 * the user API gives the ids alone, so each department's members are
 * searched for them by email. A person belongs to a handful at most.
 */
export function useMemberships(
  user: Pick<UserResponseDto, 'id' | 'email'> | null,
  departmentIds: string[],
): { departmentId: string; isPrimary: boolean }[] | null {
  const { can } = useViewer();
  const results = useQueries({
    queries: departmentIds.map((departmentId) =>
      getDepartmentsControllerListMembersV1QueryOptions(
        departmentId,
        { searchTerm: user?.email, limit: 10 },
        { query: { enabled: Boolean(user) && can('department.read') } },
      ),
    ),
  });
  if (!user || results.some((result) => !result.data)) return null;
  return departmentIds.map((departmentId, index) => ({
    departmentId,
    isPrimary:
      results[index].data?.data?.items.some(
        (member) => member.user.id === user.id && member.isPrimary,
      ) ?? false,
  }));
}
