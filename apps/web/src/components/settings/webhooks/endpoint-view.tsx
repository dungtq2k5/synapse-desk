'use client';

import {
  webhookEndpointsControllerDeleteV1,
  webhookEndpointsControllerRotateSecretV1,
  webhookEndpointsControllerTestV1,
  webhookEndpointsControllerUpdateV1,
  useWebhookEndpointsControllerGetV1,
  useWebhookEndpointsControllerListDeliveriesV1,
  type TestWebhookResponseDto,
  type WebhookEndpointResponseDto,
} from '@synapsedesk/api-client';
import {
  CircleCheckIcon,
  CircleXIcon,
  EllipsisIcon,
  KeyRoundIcon,
  PencilIcon,
  PowerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { EVENT_TYPE_WORDS } from '@/lib/administration';
import { clockTime, dayDate, logTime, relativeTime } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { DeliveryStatus, EndpointStatus } from '../badges';
import { ConfirmDialog, useMenuHandoff } from '../confirm-dialog';
import { refusalText, serverRefusal } from '../people/person-dialogs';
import { LoadError, SettingsFrame } from '../settings-frame';
import {
  EndpointDialog,
  SecretDialog,
  whyOff,
  useWebhookCache,
} from './webhooks-view';
import { PageUnavailable } from '@/components/shell/page-unavailable';

const DELIVERIES_SHOWN = 50;
/** How long the old secret keeps signing after a rotation (the server's rule). */
const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** A delivery's time: relative today, then the log's day and time. */
function deliveredWhen(at: string): string {
  const now = new Date();
  return new Date(at).toDateString() === now.toDateString()
    ? relativeTime(at, now)
    : logTime(at, now);
}

/** What a test answered, in words. */
function testOutcome(result: TestWebhookResponseDto): {
  ok: boolean;
  title: string;
  description: string;
} {
  if (result.delivered) {
    return {
      ok: true,
      title: 'Test delivered',
      description: `The receiver answered ${result.responseStatus ?? 'OK'}.`,
    };
  }
  return {
    ok: false,
    title: 'Test failed',
    description:
      result.responseStatus === null
        ? `The receiver couldn’t be reached: ${result.error ?? 'no answer'}.`
        : `The receiver answered ${result.responseStatus}${result.error ? ` ${result.error}` : ''}.`,
  };
}

/** Settings › Webhooks › one endpoint: test, turn on or off, events, deliveries. */
export function EndpointView({ endpointId }: { endpointId: string }) {
  const { can, query: viewer } = useViewer();
  const endpoint = useWebhookEndpointsControllerGetV1(endpointId, {
    query: { enabled: can('organization.read') },
  });
  const crumbs = (label?: string) => [
    { label: 'Webhooks', href: '/settings/webhooks' },
    ...(label ? [{ label }] : []),
  ];

  if (viewer.isSuccess && !can('organization.read')) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <PageUnavailable back={{ href: '/settings', label: 'Settings' }} />
      </SettingsFrame>
    );
  }
  const data = endpoint.data?.data;
  if (endpoint.isError && !data) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <LoadError
          what="this endpoint"
          onRetry={() => void endpoint.refetch()}
        />
      </SettingsFrame>
    );
  }
  if (!data) {
    return (
      <SettingsFrame crumbs={crumbs()}>
        <Skeleton className="h-96 w-full" />
      </SettingsFrame>
    );
  }
  return (
    <SettingsFrame crumbs={crumbs(data.description ?? data.url)}>
      <Endpoint endpoint={data} />
    </SettingsFrame>
  );
}

function Endpoint({ endpoint }: { endpoint: WebhookEndpointResponseDto }) {
  const { can } = useViewer();
  const router = useRouter();
  const refresh = useWebhookCache();
  const manage = can('organization.update');
  const [test, setTest] = useState<ReturnType<typeof testOutcome> | null>(null);
  const [testing, setTesting] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'rotate' | 'delete' | null>(
    null,
  );
  const menu = useMenuHandoff();
  const [secret, setSecret] = useState<{
    url: string;
    value: string;
    until: Date;
  } | null>(null);
  const systemOff = !endpoint.isActive && endpoint.disabledCode !== null;

  const sendTest = async () => {
    setTesting(true);
    try {
      const result = await webhookEndpointsControllerTestV1(endpoint.id);
      setTest(testOutcome(result.data));
      void refresh();
    } catch (error) {
      toastError('Couldn’t send it', refusalText(error));
    } finally {
      setTesting(false);
    }
  };

  const setActive = async (isActive: boolean) => {
    try {
      await webhookEndpointsControllerUpdateV1(endpoint.id, { isActive });
      toast.success(isActive ? 'Endpoint turned on.' : 'Endpoint turned off.');
      void refresh();
    } catch (error) {
      toastError('Couldn’t change it', refusalText(error));
    }
  };

  const testButton = (
    <Button
      variant="outline"
      disabled={testing}
      onClick={() => void sendTest()}
    >
      <ZapIcon aria-hidden />
      Send test
    </Button>
  );
  const powerButton = (
    <Button
      variant="outline"
      onClick={() => void setActive(!endpoint.isActive)}
    >
      <PowerIcon aria-hidden />
      {endpoint.isActive ? 'Turn off' : 'Turn on'}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Endpoint</h1>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {testButton}
            {powerButton}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="shadow-md"
                onCloseAutoFocus={menu.onCloseAutoFocus}
              >
                <DropdownMenuItem
                  onSelect={() => menu.handOff(() => setDialog('edit'))}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => menu.handOff(() => setDialog('rotate'))}
                >
                  Rotate secret
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => menu.handOff(() => setDialog('delete'))}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm break-all">{endpoint.url}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <EndpointStatus
            isActive={endpoint.isActive}
            disabledCode={endpoint.disabledCode}
          />
          {endpoint.description}
        </div>
      </div>
      {systemOff && (
        <Alert variant="warning">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>SynapseDesk turned this endpoint off</AlertTitle>
          <AlertDescription>
            <p>
              {whyOff(endpoint).replace(/\.$/, '')}, so they stopped. Fix the
              receiver, send a test, then turn it on again.
            </p>
            {manage && (
              <div className="mt-2 flex flex-wrap gap-2">
                {testButton}
                {powerButton}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      {test && (
        <Alert variant={test.ok ? 'success' : 'destructive'}>
          {test.ok ? (
            <CircleCheckIcon aria-hidden />
          ) : (
            <CircleXIcon aria-hidden />
          )}
          <AlertTitle>{test.title}</AlertTitle>
          <AlertDescription>{test.description}</AlertDescription>
        </Alert>
      )}
      <Section
        title="Events"
        aside={
          manage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialog('edit')}
            >
              <PencilIcon aria-hidden />
              Edit
            </Button>
          )
        }
      >
        <ul className="flex flex-wrap gap-2">
          {endpoint.eventTypes.map((type) => (
            <li
              key={type}
              className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {EVENT_TYPE_WORDS[type] ?? type}
            </li>
          ))}
        </ul>
      </Section>
      <Deliveries endpointId={endpoint.id} />
      {manage && (
        <section aria-labelledby="endpoint-danger">
          <div className="flex flex-col gap-5 rounded-xl border border-destructive-border bg-card p-6 text-card-foreground shadow-sm">
            <header className="flex flex-col gap-1">
              <h2
                id="endpoint-danger"
                className="text-base font-semibold text-destructive"
              >
                Delete this endpoint
              </h2>
              <p className="text-sm text-muted-foreground">Danger zone</p>
            </header>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                Deliveries stop and its delivery history is deleted.
              </p>
              <Button
                variant="destructive"
                className="w-fit shrink-0"
                onClick={() => setDialog('delete')}
              >
                <Trash2Icon aria-hidden />
                Delete
              </Button>
            </div>
          </div>
        </section>
      )}
      <EndpointDialog
        endpoint={endpoint}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
      />
      <ConfirmDialog
        open={dialog === 'rotate'}
        onOpenChange={(open) => setDialog(open ? 'rotate' : null)}
        title="Rotate the signing secret?"
        description="You get a new secret now. The old one keeps working for 24 hours, so update the receiver before then."
        confirmLabel="Rotate secret"
        icon={KeyRoundIcon}
        destructive={false}
        onConfirm={async () => {
          try {
            const rotated = await webhookEndpointsControllerRotateSecretV1(
              endpoint.id,
            );
            setSecret({
              url: rotated.data.endpoint.url,
              value: rotated.data.secret,
              until: new Date(Date.now() + ROTATION_OVERLAP_MS),
            });
            void refresh();
          } catch (error) {
            return serverRefusal('Couldn’t rotate it', error);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title="Delete this endpoint?"
        description={`Deliveries to ${endpoint.url} stop now, and its delivery history is deleted.`}
        confirmLabel="Delete"
        icon={Trash2Icon}
        onConfirm={async () => {
          try {
            await webhookEndpointsControllerDeleteV1(endpoint.id);
            toast.success('Endpoint deleted.');
            void refresh();
            router.push('/settings/webhooks');
          } catch (error) {
            return serverRefusal('Couldn’t delete it', error);
          }
        }}
      />
      <SecretDialog
        title="New signing secret"
        secret={secret}
        note={
          secret
            ? `The old secret keeps working until ${dayDate(secret.until)}, ${clockTime(secret.until)}, so update the receiver before then.`
            : undefined
        }
        onDone={() => setSecret(null)}
      />
    </>
  );
}

function Section({
  title,
  lead,
  aside,
  children,
}: {
  title: string;
  lead?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">{title}</h2>
              {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
            </div>
            {aside}
          </header>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

/** The newest deliveries: the server answers one page, newest first. */
function Deliveries({ endpointId }: { endpointId: string }) {
  const deliveries = useWebhookEndpointsControllerListDeliveriesV1(endpointId, {
    limit: DELIVERIES_SHOWN,
  });
  const items = deliveries.data?.data?.items;
  return (
    <Section title="Deliveries" lead="Newest first.">
      {deliveries.isError && !items ? (
        <LoadError
          what="the deliveries"
          onRetry={() => void deliveries.refetch()}
        />
      ) : !items ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deliveries yet.</p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell>
                      {EVENT_TYPE_WORDS[
                        delivery.eventType as keyof typeof EVENT_TYPE_WORDS
                      ] ?? delivery.eventType}
                    </TableCell>
                    <TableCell>
                      <DeliveryStatus status={delivery.status} />
                    </TableCell>
                    <TableCell>{delivery.attempts}</TableCell>
                    <TableCell>{delivery.responseStatus ?? '—'}</TableCell>
                    <TableCell className="max-w-48 whitespace-normal">
                      {delivery.lastError ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={delivery.occurredAt}>
                        {deliveredWhen(delivery.occurredAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 lg:hidden">
            {items.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {EVENT_TYPE_WORDS[
                      delivery.eventType as keyof typeof EVENT_TYPE_WORDS
                    ] ?? delivery.eventType}
                  </span>
                  <DeliveryStatus status={delivery.status} />
                </div>
                <span className="text-muted-foreground">
                  {delivery.attempts}{' '}
                  {delivery.attempts === 1 ? 'attempt' : 'attempts'}
                  {delivery.responseStatus !== null &&
                    ` · ${delivery.responseStatus}`}
                  {delivery.lastError && ` · ${delivery.lastError}`} ·{' '}
                  <time dateTime={delivery.occurredAt}>
                    {deliveredWhen(delivery.occurredAt)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
