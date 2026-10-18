'use client';

import {
  invitationsControllerResendV1,
  invitationsControllerRevokeV1,
  useInvitationsControllerListV1,
  type InvitationResponseDto,
  type InvitationsControllerListV1Status,
} from '@synapsedesk/api-client';
import { MailIcon, SendIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ALL,
  Empty,
  FilterSelect,
  Pagination,
  useDepartmentNames,
} from '@/components/documents/parts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewer } from '@/hooks/use-viewer';
import { dayDate, relativeTime } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { InvitationStatus } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import {
  LoadError,
  SettingsFrame,
  SettingsUnavailable,
} from '../settings-frame';
import { InviteButton } from './invite-dialog';
import { refusalText, serverRefusal } from './person-dialogs';
import { PeopleHeader, usePeopleCache, useRoles } from './shared';

const STATUSES = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

/** "Sent today", "Sent 2 Oct 2026", or how often it was resent and when. */
function sentLabel(invitation: InvitationResponseDto): string {
  if (invitation.resentCount > 0) {
    const times =
      invitation.resentCount === 1
        ? 'once'
        : invitation.resentCount === 2
          ? 'twice'
          : `${invitation.resentCount} times`;
    return `Resent ${times} · ${relativeTime(invitation.lastSentAt).toLowerCase()}`;
  }
  return relativeTime(invitation.createdAt).match(/min ago|hr ago|Just now/)
    ? 'Sent today'
    : `Sent ${dayDate(invitation.createdAt)}`;
}

function expiryLabel(invitation: InvitationResponseDto): string {
  switch (invitation.status) {
    case 'PENDING': {
      const days = Math.max(
        1,
        Math.ceil(
          (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000,
        ),
      );
      return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
    }
    case 'EXPIRED':
      return `Expired ${dayDate(invitation.expiresAt)}`;
    case 'ACCEPTED':
      return 'Accepted';
    case 'REVOKED':
      return 'Revoked';
    default:
      return '—';
  }
}

/** Settings › People › Invitations: each one's status, and Resend or Revoke. */
export function InvitationsView() {
  const { can, query: viewer } = useViewer();
  const departments = useDepartmentNames();
  const { names: roleNames } = useRoles();
  const [status, setStatus] = useState<
    InvitationsControllerListV1Status | undefined
  >();
  const [page, setPage] = useState(1);
  const list = useInvitationsControllerListV1(
    { page, limit: 10, status, sortBy: 'createdAt', sortOrder: 'DESC' },
    { query: { enabled: can('user.read') } },
  );

  if (viewer.isSuccess && !can('user.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'People', href: '/settings/people' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const data = list.data?.data;
  const scope = (invitation: InvitationResponseDto) => {
    const roles = invitation.roleIds.map((id) => roleNames.get(id) ?? id);
    const places = [
      ...(invitation.primaryDepartmentId
        ? [
            `${departments.get(invitation.primaryDepartmentId) ?? 'Unknown department'} (primary)`,
          ]
        : []),
      ...invitation.departmentIds
        .filter((id) => id !== invitation.primaryDepartmentId)
        .map((id) => departments.get(id) ?? 'Unknown department'),
    ];
    return (
      [roles.join(', '), places.join(', ')].filter(Boolean).join(' · ') || '—'
    );
  };

  return (
    <SettingsFrame
      crumbs={[
        { label: 'People', href: '/settings/people' },
        { label: 'Invitations' },
      ]}
    >
      <PeopleHeader
        tab="invitations"
        action={can('user.invite') && <InviteButton />}
      />
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          label="Status"
          value={status}
          options={STATUSES}
          onValue={(value) => {
            setStatus(
              value === ALL
                ? undefined
                : (value as InvitationsControllerListV1Status),
            );
            setPage(1);
          }}
        />
      </div>
      {list.isError && !data ? (
        <LoadError what="the invitations" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Skeleton className="h-80 w-full" />
      ) : data.items.length === 0 ? (
        <Empty
          icon={<MailIcon />}
          title="No invitations"
          description="Invite people to join, and their invitations show here until they accept."
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Roles and departments</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{invitation.email}</span>
                        {invitation.invitedByName && (
                          <span className="text-xs text-muted-foreground">
                            Invited by {invitation.invitedByName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <InvitationStatus status={invitation.status} />
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      {scope(invitation)}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      <time dateTime={invitation.lastSentAt}>
                        {sentLabel(invitation)}
                      </time>
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      <time dateTime={invitation.expiresAt}>
                        {expiryLabel(invitation)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions invitation={invitation} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.items.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium break-all">
                    {invitation.email}
                  </span>
                  <RowActions invitation={invitation} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <InvitationStatus status={invitation.status} />
                  <time dateTime={invitation.expiresAt}>
                    {expiryLabel(invitation)}
                  </time>
                </div>
                <p className="text-sm">{scope(invitation)}</p>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination meta={data.meta} onPage={setPage} noun="invitations" />
          )}
        </>
      )}
    </SettingsFrame>
  );
}

function RowActions({ invitation }: { invitation: InvitationResponseDto }) {
  const { can } = useViewer();
  const refresh = usePeopleCache();
  const [revoking, setRevoking] = useState(false);
  if (invitation.status !== 'PENDING' || !can('user.invite')) return null;

  const resend = async () => {
    try {
      await invitationsControllerResendV1(invitation.id);
      toast.success(
        `A new link went to ${invitation.email}. The old one no longer works.`,
      );
      void refresh();
    } catch (error) {
      toastError('Couldn’t resend it', refusalText(error));
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Resend to ${invitation.email}`}
        onClick={() => void resend()}
      >
        <SendIcon aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`Revoke the invitation to ${invitation.email}`}
        onClick={() => setRevoking(true)}
      >
        <XIcon aria-hidden />
      </Button>
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke the invitation to ${invitation.email}?`}
        description="The link stops working now and the seat is freed. You can invite them again later."
        confirmLabel="Revoke"
        onConfirm={async () => {
          try {
            await invitationsControllerRevokeV1(invitation.id);
            void refresh();
          } catch (error) {
            return serverRefusal('Couldn’t revoke it', error);
          }
        }}
      />
    </div>
  );
}
