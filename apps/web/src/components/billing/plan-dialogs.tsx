'use client';

import {
  ApiError,
  billingControllerChangePlanV1,
  billingControllerCreateCheckoutSessionV1,
  billingControllerGetSubscriptionV1,
  type OverLimit,
  type PlanChangeResponseDto,
} from '@synapsedesk/api-client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LifeBuoyIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fixFor, overLimitSentence, type ComparisonRow } from '@/lib/billing';
import { leaveFor } from '@/lib/leave';
import { useSupportEmail } from '@/lib/support';
import { cn } from '@/lib/utils';
import { useOpenPortal } from './use-open-portal';

/** A change the confirmation describes: its words, worked out by the page. */
export type ChangeIntent = {
  kind: 'upgrade' | 'change' | 'switch';
  planId: string;
  planName: string;
  priceId: string;
  /** The deck's title and lead for this kind, filled in. */
  title: string;
  lead: string;
  /** "Everything you use today fits Pro." / "What Pro includes stays the same." */
  note?: string;
  action: string;
  rows: ComparisonRow[];
};

/** Why the server refused, as the dialog says it. */
type Refusal =
  | 'negotiated'
  | 'retired'
  | 'unreachable'
  | 'declined'
  | 'no-subscription'
  | { other: string };

const REFUSAL: Record<
  Exclude<Refusal, { other: string }>,
  { title: string; text: string }
> = {
  negotiated: {
    title: 'Your plan can’t be changed here',
    text: 'It was agreed with the SynapseDesk team. To change it, contact support.',
  },
  retired: {
    title: 'is no longer offered',
    text: 'Nothing changed. The plans have been refreshed; choose another one.',
  },
  unreachable: {
    title: 'Stripe isn’t responding',
    text: 'Nothing changed. Try again in a few minutes.',
  },
  declined: {
    title: 'Your card was declined',
    text: 'Nothing changed. Update your card on Stripe, then try again.',
  },
  'no-subscription': {
    title: 'There’s no subscription to change',
    text: 'Choose a plan to start one.',
  },
};

/**
 * Which refusal an error is: by status and data, never by the sentence. A
 * 400 without items is told apart by re-reading the subscription.
 */
async function refusalOf(error: unknown): Promise<Refusal> {
  if (!(error instanceof ApiError)) return 'unreachable';
  if (error.status === 402) return 'declined';
  if (error.status === 404) return 'retired';
  if (error.status === 503) return 'unreachable';
  if (error.status === 400) {
    const subscription = await billingControllerGetSubscriptionV1()
      .then((answer) => answer.data)
      .catch(() => null);
    if (subscription?.negotiated) return 'negotiated';
    if (subscription && !subscription.stripeSubscriptionId) {
      return 'no-subscription';
    }
  }
  return { other: error.message };
}

/** The comparison: a `dl`, one row per grant both plans have. */
export function Comparison({ rows }: { rows: ComparisonRow[] }) {
  return (
    <dl className="divide-y rounded-lg border text-sm">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 px-3 py-2"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd
            aria-label={
              row.from === row.to
                ? `${row.label}: ${row.to}`
                : `${row.label}: from ${row.from} to ${row.to}`
            }
          >
            {row.from === row.to ? row.to : `${row.from} → ${row.to}`}
          </dd>
          <span aria-hidden className="text-success-subtle-foreground">
            {row.direction === 'more' && <ArrowUpIcon className="size-4" />}
            {row.direction === 'less' && (
              <ArrowDownIcon className="size-4 text-warning-subtle-foreground" />
            )}
          </span>
        </div>
      ))}
    </dl>
  );
}

/**
 * The plan-change confirmation: what it costs, the comparison, then Cancel
 * and the change. A refusal appears above the buttons and the main button
 * becomes what helps; one that doesn't fit hands over to the doesn't-fit
 * dialog.
 */
export function ChangeDialog({
  intent,
  onClose,
  onChanged,
  onDoesntFit,
}: {
  intent: ChangeIntent | null;
  onClose: () => void;
  onChanged: (answer: PlanChangeResponseDto, intent: ChangeIntent) => void;
  onDoesntFit: (planName: string, items: OverLimit[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const main = useRef<HTMLButtonElement>(null);
  const portal = useOpenPortal();
  const support = useSupportEmail();

  const close = () => {
    if (busy) return;
    setRefusal(null);
    onClose();
  };

  const submit = async () => {
    if (!intent) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await billingControllerChangePlanV1({
        planId: intent.planId,
        priceId: intent.priceId,
      });
      setBusy(false);
      onChanged(answer.data, intent);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.overLimit.length > 0) {
        onDoesntFit(intent.planName, error.overLimit);
        return;
      }
      setRefusal(await refusalOf(error));
      globalThis.setTimeout(() => main.current?.focus(), 0);
    }
  };

  const said =
    refusal === null
      ? null
      : typeof refusal === 'object'
        ? { title: 'Couldn’t change the plan', text: refusal.other }
        : refusal === 'retired'
          ? {
              ...REFUSAL.retired,
              title: `${intent?.planName} ${REFUSAL.retired.title}`,
            }
          : REFUSAL[refusal];

  return (
    <Dialog open={intent !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-120"
        onOpenAutoFocus={(event) => {
          // It costs money: Cancel first.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLButtonElement>('[data-cancel]')
            ?.focus();
        }}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        {intent && (
          <>
            <DialogHeader>
              <DialogTitle>{intent.title}</DialogTitle>
              <DialogDescription>{intent.lead}</DialogDescription>
            </DialogHeader>
            <Comparison rows={intent.rows} />
            {intent.note && (
              <p className="text-sm text-muted-foreground">{intent.note}</p>
            )}
            {said && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertTitle>{said.title}</AlertTitle>
                <AlertDescription>{said.text}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" data-cancel disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              {refusal === 'negotiated' ? (
                <a
                  href={`mailto:${support}`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Contact support
                  <LifeBuoyIcon aria-hidden />
                </a>
              ) : refusal === 'declined' ? (
                <Button
                  ref={main}
                  variant="outline"
                  disabled={portal.busy}
                  onClick={() => void portal.open()}
                >
                  {portal.busy ? 'Opening Stripe…' : 'Manage billing on Stripe'}
                  <span className="sr-only"> (opens Stripe)</span>
                  <ExternalLinkIcon aria-hidden />
                </Button>
              ) : refusal === 'retired' || refusal === 'no-subscription' ? (
                <Button ref={main} onClick={close}>
                  Choose another plan
                </Button>
              ) : (
                <Button
                  ref={main}
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy && (
                    <LoaderCircleIcon aria-hidden className="animate-spin" />
                  )}
                  {busy
                    ? 'Changing plan…'
                    : refusal === 'unreachable'
                      ? 'Try again'
                      : intent.action}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A plan a free organization is about to start, as Start describes it. */
export type StartIntent = {
  planName: string;
  priceId: string;
  price: string;
  rows: ComparisonRow[];
};

/**
 * Start a subscription: the price, the comparison with Free, and Continue to
 * Stripe, which leaves for Stripe's Checkout. A plan too small comes back as
 * the doesn't-fit dialog, the same as a plan change.
 */
export function StartDialog({
  intent,
  onClose,
  onDoesntFit,
}: {
  intent: StartIntent | null;
  onClose: () => void;
  onDoesntFit: (planName: string, items: OverLimit[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const start = async () => {
    if (!intent) return;
    setBusy(true);
    setRefusal(null);
    const page = `${globalThis.location.origin}/settings/billing`;
    try {
      const answer = await billingControllerCreateCheckoutSessionV1({
        priceId: intent.priceId,
        // The plan's name rides back, for the wait's words.
        successUrl: `${page}?checkout=success&plan=${encodeURIComponent(intent.planName)}`,
        cancelUrl: `${page}?checkout=canceled`,
      });
      leaveFor(answer.data.url);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.overLimit.length > 0) {
        onDoesntFit(intent.planName, error.overLimit);
        return;
      }
      setRefusal(
        error instanceof ApiError && error.status === 400
          ? error.message
          : 'Stripe isn’t responding. Try again in a few minutes.',
      );
    }
  };

  return (
    <Dialog
      open={intent !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <DialogContent
        className="sm:max-w-120"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLButtonElement>('[data-cancel]')
            ?.focus();
        }}
      >
        {intent && (
          <>
            <DialogHeader>
              <DialogTitle>{`Start ${intent.planName}`}</DialogTitle>
              <DialogDescription>
                {`${intent.planName} is ${intent.price}, starting today.`}
              </DialogDescription>
            </DialogHeader>
            <Comparison rows={intent.rows} />
            <p className="text-sm text-muted-foreground">
              You’ll pay on Stripe’s secure page, then come back here. Nothing
              is charged until you confirm there.
            </p>
            {refusal && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon aria-hidden />
                <AlertTitle>Couldn’t open Stripe</AlertTitle>
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" data-cancel disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={busy} onClick={() => void start()}>
                {busy && (
                  <LoaderCircleIcon aria-hidden className="animate-spin" />
                )}
                {busy ? 'Opening Stripe…' : 'Continue to Stripe'}
                {!busy && <span className="sr-only"> (opens Stripe)</span>}
                {!busy && <ExternalLinkIcon aria-hidden />}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The server's "doesn't fit", for a change and for Checkout alike: one item
 * per limit, each with where it's fixed, then Choose another plan.
 */
export function DoesntFitDialog({
  refused,
  organization,
  onClose,
}: {
  refused: { planName: string; items: OverLimit[] } | null;
  organization: string;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={refused !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent className="sm:max-w-110">
        {refused && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {`${refused.planName} doesn’t fit ${organization}`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {`Nothing changed. ${refused.planName} allows less than you use today:`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
              {refused.items.map((item) => {
                const fix = fixFor(item);
                return (
                  <li key={item.dimension} className="flex flex-col gap-1.5">
                    <span>
                      {overLimitSentence(item, refused.planName, true)}
                    </span>
                    <Link
                      href={fix.href}
                      className={cn(
                        'inline-flex w-fit items-center gap-1 font-medium text-primary underline-offset-4 hover:underline',
                      )}
                    >
                      {fix.label}
                      <ChevronRightIcon aria-hidden className="size-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <AlertDialogFooter>
              <Button autoFocus onClick={onClose}>
                Choose another plan
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
