'use client';

import {
  ApiError,
  webhookEndpointsControllerCreateV1,
  webhookEndpointsControllerUpdateV1,
  useWebhookEndpointsControllerListEventTypesV1,
  useWebhookEndpointsControllerListV1,
  type WebhookEndpointResponseDto,
  type WebhookEndpointResponseDtoEventTypesItem as EventType,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, TriangleAlertIcon, WebhookIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { Empty } from '@/components/documents/parts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import { EVENT_TYPE_WORDS } from '@/lib/administration';
import { asSentence } from '@/lib/documents';
import { EndpointStatus } from '../badges';
import { CopyField } from '../copy-field';
import { refusalText } from '../people/person-dialogs';
import { useOrganizationName } from '../people/shared';
import {
  LoadError,
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from '../settings-frame';

const URL_MAX = 2000;
const DESCRIPTION_MAX = 500;
/** Every event an endpoint can take, the catalog's order. */
export const EVENT_TYPES = Object.keys(EVENT_TYPE_WORDS) as EventType[];

/** Refetches every webhook view after a change. */
export function useWebhookCache() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        typeof queryKey[0] === 'string' &&
        queryKey[0].startsWith('/api/v1/webhook-endpoints'),
    });
}

/** "2 events", "1 event", or "All 10 events". */
export function eventCount(count: number, total: number): string {
  if (count === total) return `All ${total} events`;
  return count === 1 ? '1 event' : `${count} events`;
}

/**
 * Why SynapseDesk turned it off, in words: the server's reason carries the
 * failure count.
 *
 * @example failedInARow('Auto-disabled after 10 consecutive failed deliveries') // 'Deliveries failed 10 times in a row.'
 */
export function failedInARow(reason: string): string {
  const count = /(\d+) consecutive/.exec(reason)?.[1];
  return count
    ? `Deliveries failed ${count} times in a row.`
    : asSentence(reason);
}

/** Settings › Webhooks: each endpoint, its events and its status. */
export function WebhooksView() {
  const { can, query: viewer } = useViewer();
  const organization = useOrganizationName();
  const [creating, setCreating] = useState(false);
  const list = useWebhookEndpointsControllerListV1({
    query: { enabled: can('organization.read') },
  });

  if (viewer.isSuccess && !can('organization.read')) {
    return (
      <SettingsFrame crumbs={[{ label: 'Webhooks' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const items = list.data?.data?.items;
  const newButton = can('organization.update') && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon aria-hidden />
      New endpoint
    </Button>
  );

  return (
    <SettingsFrame crumbs={[{ label: 'Webhooks' }]}>
      <PageHeading
        title="Webhooks"
        description={`Send ${organization || 'your organization'}’s events to your own systems, signed so you can check they came from us.`}
        action={items && items.length > 0 && newButton}
      />
      {list.isError && !items ? (
        <LoadError what="the endpoints" onRetry={() => void list.refetch()} />
      ) : !items ? (
        <Skeleton className="h-60 w-full" />
      ) : items.length === 0 ? (
        <Empty
          icon={<WebhookIcon />}
          title="No endpoints yet"
          description="Add an HTTPS address and choose which events to send to it."
          action={newButton}
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((endpoint) => (
                  <TableRow key={endpoint.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <EndpointCell endpoint={endpoint} />
                    </TableCell>
                    <TableCell>
                      {eventCount(
                        endpoint.eventTypes.length,
                        EVENT_TYPES.length,
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <StatusCell endpoint={endpoint} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((endpoint) => (
              <li
                key={endpoint.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <EndpointCell endpoint={endpoint} />
                <StatusCell endpoint={endpoint} />
                <p className="text-sm">
                  {eventCount(endpoint.eventTypes.length, EVENT_TYPES.length)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <EndpointDialog open={creating} onOpenChange={setCreating} />
    </SettingsFrame>
  );
}

function EndpointCell({ endpoint }: { endpoint: WebhookEndpointResponseDto }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/settings/webhooks/${endpoint.id}`}
        className="font-mono text-sm break-all text-primary underline-offset-4 hover:underline"
      >
        {endpoint.url}
      </Link>
      {endpoint.description && (
        <span className="text-xs text-muted-foreground">
          {endpoint.description}
        </span>
      )}
    </div>
  );
}

function StatusCell({ endpoint }: { endpoint: WebhookEndpointResponseDto }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <EndpointStatus
        isActive={endpoint.isActive}
        disabledReason={endpoint.disabledReason}
      />
      {!endpoint.isActive && endpoint.disabledReason && (
        <span className="text-xs text-warning-subtle-foreground">
          {failedInARow(endpoint.disabledReason)}
        </span>
      )}
    </div>
  );
}

/**
 * New endpoint, or Edit endpoint: the HTTPS address, a description and at
 * least one event. A new one shows its signing secret once, then opens.
 */
export function EndpointDialog({
  endpoint,
  open,
  onOpenChange,
}: {
  endpoint?: WebhookEndpointResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const refresh = useWebhookCache();
  const catalog = useWebhookEndpointsControllerListEventTypesV1({
    query: { staleTime: 300_000 },
  });
  const types = catalog.data?.data?.types ?? EVENT_TYPES;
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<ReadonlySet<EventType>>(new Set());
  const [errors, setErrors] = useState<{
    url?: string;
    events?: string;
    form?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{
    id: string;
    url: string;
    value: string;
  } | null>(null);

  const check = () => {
    const found: typeof errors = {};
    const trimmed = url.trim();
    if (!/^https:\/\//i.test(trimmed)) found.url = 'Use an https:// address.';
    else if (trimmed.length > URL_MAX)
      found.url = 'Use 2,000 characters or fewer.';
    if (events.size === 0) found.events = 'Choose at least one event.';
    return found;
  };

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = check();
    setErrors(found);
    if (found.url || found.events) return;
    setBusy(true);
    const body = {
      url: url.trim(),
      description: description.trim() || null,
      eventTypes: types.filter((type) => events.has(type)),
    };
    try {
      if (endpoint) {
        await webhookEndpointsControllerUpdateV1(endpoint.id, body);
        void refresh();
        onOpenChange(false);
      } else {
        const created = await webhookEndpointsControllerCreateV1(body);
        void refresh();
        onOpenChange(false);
        setSecret({
          id: created.data.endpoint.id,
          url: created.data.endpoint.url,
          value: created.data.secret,
        });
      }
    } catch (error) {
      setErrors({
        form:
          error instanceof ApiError
            ? asSentence(error.message)
            : refusalText(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (type: EventType, on: boolean) => {
    const next = new Set(events);
    if (on) next.add(type);
    else next.delete(type);
    setEvents(next);
  };

  // Each opening starts afresh: a controlled dialog's onOpenChange
  // only hears it close.
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setUrl(endpoint?.url ?? '');
      setDescription(endpoint?.description ?? '');
      setEvents(new Set(endpoint?.eventTypes ?? []));
      setErrors({});
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => void save(event)}
            noValidate
          >
            <DialogHeader>
              <DialogTitle>
                {endpoint ? 'Edit endpoint' : 'New endpoint'}
              </DialogTitle>
            </DialogHeader>
            <Field
              id="endpoint-url"
              label="URL"
              description="HTTPS only."
              error={errors.url}
            >
              {(aria) => (
                <Input
                  id="endpoint-url"
                  type="url"
                  inputMode="url"
                  className="font-mono"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  {...aria}
                />
              )}
            </Field>
            <Field
              id="endpoint-description"
              label="Description (optional)"
              count={{ length: description.length, max: DESCRIPTION_MAX }}
            >
              {(aria) => (
                <Textarea
                  id="endpoint-description"
                  value={description}
                  maxLength={DESCRIPTION_MAX}
                  onChange={(event) => setDescription(event.target.value)}
                  {...aria}
                />
              )}
            </Field>
            <fieldset
              className="flex flex-col gap-3"
              aria-describedby={
                errors.events ? 'endpoint-events-error' : undefined
              }
            >
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Events to send</legend>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setEvents(new Set(types))}
                >
                  Select all
                </Button>
              </div>
              {types.map((type) => (
                <div key={type} className="flex items-start gap-2">
                  <Checkbox
                    id={`event-${type}`}
                    checked={events.has(type)}
                    onCheckedChange={(state) => toggle(type, state === true)}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor={`event-${type}`}
                    className="flex flex-col items-start gap-0.5 font-normal"
                  >
                    {EVENT_TYPE_WORDS[type] ?? type}
                    <code className="font-mono text-xs text-muted-foreground">
                      {type}
                    </code>
                  </Label>
                </div>
              ))}
              {errors.events && (
                <p
                  id="endpoint-events-error"
                  className="text-sm text-destructive"
                >
                  {errors.events}
                </p>
              )}
            </fieldset>
            {errors.form && (
              <p role="alert" className="text-sm text-destructive">
                {errors.form}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {endpoint ? 'Save changes' : 'Create endpoint'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <SecretDialog
        title="Endpoint created"
        secret={secret}
        onDone={() => {
          const id = secret?.id;
          setSecret(null);
          if (id) router.push(`/settings/webhooks/${id}`);
        }}
      />
    </>
  );
}

/**
 * The signing secret, shown once: Copy, and Done only after saying it's
 * stored. Closing any other way isn't offered, so it can't be lost by a
 * stray click outside.
 */
export function SecretDialog({
  title,
  secret,
  note,
  onDone,
}: {
  title: string;
  secret: { url: string; value: string } | null;
  /** Under the secret: when the old one stops, after rotating. */
  note?: string;
  onDone: () => void;
}) {
  const [stored, setStored] = useState(false);

  return (
    <Dialog open={secret !== null}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="font-mono break-all">
            {secret?.url}
          </DialogDescription>
        </DialogHeader>
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Copy the signing secret now</AlertTitle>
          <AlertDescription>
            You won’t see it again. Store it with the receiver, which uses it to
            check each delivery came from SynapseDesk.
          </AlertDescription>
        </Alert>
        {secret && <CopyField label="Signing secret" value={secret.value} />}
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        <div className="flex items-center gap-2">
          <Checkbox
            id="secret-stored"
            checked={stored}
            onCheckedChange={(state) => setStored(state === true)}
          />
          <Label htmlFor="secret-stored" className="font-normal">
            I’ve stored the secret somewhere safe
          </Label>
        </div>
        <DialogFooter>
          <Button
            disabled={!stored}
            onClick={() => {
              setStored(false);
              onDone();
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
