'use client';

import {
  notificationsControllerUpdatePreferenceV1,
  useNotificationsControllerListPreferencesV1,
  type PreferenceResponseDto,
  type UpdatePreferenceDto,
} from '@synapsedesk/api-client';
import {
  BellIcon,
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  MailIcon,
  SmartphoneIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useViewer } from '@/hooks/use-viewer';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPES,
  typesFor,
  type NotificationType,
} from '@/lib/notifications';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** The channels shown. Push is out of scope, whatever the server lists. */
const CHANNELS = [
  { channel: 'IN_APP', name: 'In-app', icon: BellIcon },
  { channel: 'EMAIL', name: 'Email', icon: MailIcon },
  { channel: 'SMS', name: 'SMS', icon: SmartphoneIcon },
] as const satisfies readonly {
  channel: UpdatePreferenceDto['channel'];
  name: string;
  icon: LucideIcon;
}[];
type Channel = (typeof CHANNELS)[number]['channel'];
type Row = NotificationType | '*';

const DIGESTS = { IMMEDIATE: 'Right away', HOURLY: 'Hourly', DAILY: 'Daily' };
type Digest = keyof typeof DIGESTS;

const SOURCE: Record<string, string> = {
  EXPLICIT: 'Set by you',
  WILDCARD: 'From “All types”',
  DEFAULT: 'Default',
};

const label = (row: Row) =>
  row === '*' ? 'All types' : NOTIFICATION_TYPES[row].label;

/**
 * How someone hears about each type, per channel: a switch (and for email,
 * how often), saved as it's changed. Every change writes the person's own
 * setting; there's no reset. Each cell says where its value comes from.
 */
export function NotificationPreferences() {
  const { can, user } = useViewer();
  const administrator = can('organization.update');
  const phone = Boolean(user?.isPhoneVerified);
  const list = useNotificationsControllerListPreferencesV1();
  const [saving, setSaving] = useState<'saving' | 'saved' | null>(null);
  // Changes not yet confirmed, shown in place of the server's value.
  const [pending, setPending] = useState<
    Record<string, Partial<PreferenceResponseDto>>
  >({});
  const smsNoteId = useId();

  const stored = new Map(
    (list.data?.data ?? []).map((item) => [
      `${item.type}|${item.channel}`,
      item,
    ]),
  );
  const cell = (row: Row, channel: Channel) => {
    const key = `${row}|${channel}`;
    const base = stored.get(key);
    return base ? { ...base, ...pending[key] } : null;
  };

  const save = async (
    row: Row,
    channel: Channel,
    change: Pick<UpdatePreferenceDto, 'isEnabled' | 'digest'>,
  ) => {
    const key = `${row}|${channel}`;
    setPending((current) => ({
      ...current,
      [key]: {
        ...change,
        source: 'EXPLICIT',
      } as Partial<PreferenceResponseDto>,
    }));
    setSaving('saving');
    try {
      await notificationsControllerUpdatePreferenceV1({
        type: row,
        channel,
        ...change,
      });
      await list.refetch();
      setSaving('saved');
    } catch {
      setSaving(null);
      toastError(
        'Couldn’t save that change',
        'It’s back to how it was. Try again in a moment.',
      );
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const rows: { group: string | null; types: Row[] }[] = [
    { group: null, types: ['*'] },
    ...NOTIFICATION_GROUPS.map((group) => ({
      group,
      types: typesFor(administrator).filter(
        (type) => NOTIFICATION_TYPES[type].group === group,
      ),
    })).filter(({ types }) => types.length > 0),
  ];

  const description = (row: Row) =>
    row === '*'
      ? 'Sets every type on a channel at once. A type you set yourself keeps its own setting.'
      : NOTIFICATION_TYPES[row].description;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Notification settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose how you hear about things. Changes save as you make them.
          </p>
        </div>
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          {saving === 'saving' && (
            <>
              <LoaderCircleIcon
                aria-hidden
                className="size-4 motion-safe:animate-spin"
              />
              Saving…
            </>
          )}
          {saving === 'saved' && (
            <>
              <CheckIcon aria-hidden className="size-4" />
              Saved
            </>
          )}
        </p>
      </div>

      {!administrator && (
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertTitle>Some notifications are for administrators</AlertTitle>
          <AlertDescription>
            Usage, billing and integration notifications go only to people who
            manage the organization.
          </AlertDescription>
        </Alert>
      )}

      {!phone && (
        <p className="text-sm text-muted-foreground md:hidden">
          <span id={smsNoteId}>
            <span className="sr-only">Verify a phone number to get texts.</span>
          </span>
          <span aria-hidden>SMS: verify a phone number to get texts.</span>{' '}
          <Link
            href="/profile"
            className="text-primary underline underline-offset-4"
          >
            Verify phone
          </Link>
        </p>
      )}

      {list.isError && !list.data ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertDescription>
            Something went wrong on our side. Try again in a moment.
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !list.data ? (
        <div aria-busy className="flex flex-col gap-3">
          <span className="sr-only" role="status">
            Loading notification settings
          </span>
          {Array.from({ length: 6 }, (_, row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-normal">
                    Type
                  </th>
                  {CHANNELS.map(({ channel, name, icon: Icon }) => (
                    <th
                      key={channel}
                      scope="col"
                      className="w-56 px-4 py-3 font-normal"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon aria-hidden className="size-4" />
                        {name}
                      </span>
                      {channel === 'SMS' && !phone && (
                        <span className="mt-1 block text-xs">
                          Verify a phone number to get texts.{' '}
                          <Link
                            href="/profile"
                            className="text-primary underline underline-offset-4"
                          >
                            Verify phone
                          </Link>
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ group, types }) => (
                  <Fragment key={group ?? 'all'}>
                    {group && (
                      <tr className="border-b">
                        <td
                          colSpan={4}
                          className="px-4 py-2 text-xs text-muted-foreground"
                        >
                          {group}
                        </td>
                      </tr>
                    )}
                    {types.map((row) => (
                      <tr
                        key={row}
                        className={cn(
                          'border-b last:border-0',
                          row === '*' && 'bg-muted',
                        )}
                      >
                        <th
                          scope="row"
                          className="px-4 py-3 text-left font-normal"
                        >
                          <span className="block font-medium">
                            {label(row)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {description(row)}
                          </span>
                        </th>
                        {CHANNELS.map(({ channel }) => (
                          <td key={channel} className="px-4 py-3 align-top">
                            <PreferenceCell
                              row={row}
                              channel={channel}
                              value={cell(row, channel)}
                              disabled={channel === 'SMS' && !phone}
                              smsNoteId={smsNoteId}
                              onSave={(change) =>
                                void save(row, channel, change)
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-4 md:hidden">
            {rows.map(({ group, types }) => (
              <section
                key={group ?? 'all'}
                aria-label={group ?? 'All types'}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                {group && (
                  <h2 className="text-xs text-muted-foreground">{group}</h2>
                )}
                {types.map((row) => (
                  <div
                    key={row}
                    role="group"
                    aria-label={label(row)}
                    className="flex flex-col gap-2 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{label(row)}</p>
                      <p className="text-xs text-muted-foreground">
                        {description(row)}
                      </p>
                    </div>
                    {CHANNELS.map(({ channel, name }) => (
                      <div
                        key={channel}
                        className="flex items-start justify-between gap-3 text-sm"
                      >
                        <span className="pt-0.5">{name}</span>
                        <PreferenceCell
                          row={row}
                          channel={channel}
                          value={cell(row, channel)}
                          disabled={channel === 'SMS' && !phone}
                          smsNoteId={smsNoteId}
                          onSave={(change) => void save(row, channel, change)}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One type on one channel: its switch, email's how-often, and where the value comes from. */
function PreferenceCell({
  row,
  channel,
  value,
  disabled,
  smsNoteId,
  onSave,
}: {
  row: Row;
  channel: Channel;
  value: PreferenceResponseDto | null;
  disabled: boolean;
  smsNoteId: string;
  onSave: (change: Pick<UpdatePreferenceDto, 'isEnabled' | 'digest'>) => void;
}) {
  const sourceId = useId();
  if (!value) return null;
  const name = CHANNELS.find((each) => each.channel === channel)!.name;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          aria-label={`${label(row)}, ${name}`}
          aria-describedby={disabled ? smsNoteId : sourceId}
          checked={value.isEnabled}
          disabled={disabled}
          onCheckedChange={(isEnabled) => onSave({ isEnabled })}
        />
        {channel === 'EMAIL' && (
          <Select
            value={
              value.digest && value.digest in DIGESTS
                ? value.digest
                : 'IMMEDIATE'
            }
            disabled={!value.isEnabled}
            onValueChange={(digest) => onSave({ digest: digest as Digest })}
          >
            <SelectTrigger
              size="sm"
              aria-label={`${label(row)}, Email, how often`}
              className="h-7 w-auto gap-1 px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="shadow-md">
              {Object.entries(DIGESTS).map(([digest, words]) => (
                <SelectItem key={digest} value={digest}>
                  {words}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <span
        id={sourceId}
        className={cn(
          'text-xs text-muted-foreground',
          value.source === 'EXPLICIT' && 'text-foreground',
        )}
      >
        {SOURCE[value.source ?? 'DEFAULT']}
      </span>
    </div>
  );
}
