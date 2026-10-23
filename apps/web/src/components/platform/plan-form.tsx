'use client';

import {
  ApiError,
  platformControllerCreatePlanV1,
  platformControllerDeletePlanV1,
  platformControllerUpdatePlanV1,
  usePlatformControllerGetPlanV1,
  type CreatePlanDto,
  type SubscriptionPlanResponseDto,
  type UpdatePlanDto,
} from '@synapsedesk/api-client';
import {
  MAX_ANALYTICS_RANGE_DAYS,
  MAX_ATTACHMENT_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
} from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleAlertIcon,
  EyeIcon,
  InfoIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { ConfirmDialog } from '@/components/settings/confirm-dialog';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { PageUnavailable } from '@/components/shell/page-unavailable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toastError } from '@/lib/toast';
import { count } from '@/lib/platform';
import { PlanBadges } from './badges';
import { ConsoleCard, ConsolePage } from './console-page';
import { bytesOf, gbOf, microsOf, UnitInput, usdOf, wholeOf } from './fields';
import { priceLine } from './plans-view';

const MIB = 1024 ** 2;
const MAX_PRICES = 12;
const REQUIRED = 'Required.';

type Grant =
  | 'seats'
  | 'storage'
  | 'ai'
  | 'document'
  | 'attachment'
  | 'documents'
  | 'analytics';

type Form = {
  name: string;
  stripeProductId: string;
  isActive: boolean;
  tier: '' | 'FAST' | 'QUALITY';
} & Record<Grant, string>;

type Price = { key: number; stripePriceId: string; interval: 'month' | 'year' };
type Errors = Partial<Record<keyof Form, string>>;

/** Each grant's box: its label, unit and what it says under it. */
const GRANTS: { key: Grant; label: string; unit?: string; help: string }[] = [
  { key: 'seats', label: 'Seats', help: 'No platform ceiling.' },
  {
    key: 'storage',
    label: 'Document storage',
    unit: 'GB',
    help: 'No platform ceiling.',
  },
  {
    key: 'ai',
    label: 'AI allowance a month',
    unit: 'USD',
    help: 'No platform ceiling.',
  },
  {
    key: 'document',
    label: 'Largest document',
    unit: 'MB',
    help: `Up to ${MAX_DOCUMENT_BYTES / MIB} MB, the platform’s ceiling.`,
  },
  {
    key: 'attachment',
    label: 'Largest attachment',
    unit: 'MB',
    help: `Up to ${MAX_ATTACHMENT_BYTES / MIB} MB, the platform’s ceiling.`,
  },
  {
    key: 'documents',
    label: 'Documents',
    help: `Up to ${MAX_DOCUMENTS_PER_TENANT.toLocaleString('en-US')}, the platform’s ceiling.`,
  },
  {
    key: 'analytics',
    label: 'Analytics ranges up to',
    unit: 'days',
    help: `Up to ${MAX_ANALYTICS_RANGE_DAYS} days, the platform’s ceiling.`,
  },
];

const EMPTY: Form = {
  name: '',
  stripeProductId: '',
  isActive: true,
  tier: '',
  seats: '',
  storage: '',
  ai: '',
  document: '',
  attachment: '',
  documents: '',
  analytics: '',
};

const mbOf = (bytes: number) => String(Number((bytes / MIB).toFixed(2)));

function formOf(plan: SubscriptionPlanResponseDto): Form {
  return {
    name: plan.name,
    stripeProductId: plan.stripeProductId ?? '',
    isActive: plan.isActive,
    tier: (plan.aiModelTier as Form['tier']) ?? '',
    seats: String(plan.maxAgentSeats),
    storage: gbOf(plan.maxStorageBytes),
    ai: usdOf(plan.monthlyAiTokenBudget),
    document: mbOf(plan.maxDocumentBytes),
    attachment: mbOf(plan.maxAttachmentBytes),
    documents: String(plan.maxDocumentUploads),
    analytics: String(plan.maxAnalyticsRangeDays),
  };
}

/** The grants as the API takes them, and each box's error. */
export function grantsOf(form: Form): {
  errors: Errors;
  values: Omit<
    CreatePlanDto,
    'name' | 'stripeProductId' | 'isActive' | 'prices'
  >;
} {
  const errors: Errors = {};
  const mb = (text: string) => {
    const value = Number(text);
    return text.trim() && Number.isFinite(value) && value > 0
      ? Math.round(value * MIB)
      : NaN;
  };
  const values = {
    maxAgentSeats: wholeOf(form.seats) ?? NaN,
    maxStorageBytes: bytesOf(form.storage) ?? NaN,
    monthlyAiTokenBudget: microsOf(form.ai) ?? NaN,
    maxDocumentBytes: mb(form.document),
    maxAttachmentBytes: mb(form.attachment),
    maxDocumentUploads: wholeOf(form.documents) ?? NaN,
    maxAnalyticsRangeDays: wholeOf(form.analytics) ?? NaN,
    aiModelTier: form.tier || 'FAST',
  };
  const keys: [Grant, number, number][] = [
    ['seats', values.maxAgentSeats, Infinity],
    ['storage', values.maxStorageBytes, Infinity],
    ['ai', values.monthlyAiTokenBudget, Infinity],
    ['document', values.maxDocumentBytes, MAX_DOCUMENT_BYTES],
    ['attachment', values.maxAttachmentBytes, MAX_ATTACHMENT_BYTES],
    ['documents', values.maxDocumentUploads, MAX_DOCUMENTS_PER_TENANT],
    ['analytics', values.maxAnalyticsRangeDays, MAX_ANALYTICS_RANGE_DAYS],
  ];
  for (const [key, value, ceiling] of keys) {
    if (
      Number.isNaN(value) ||
      value > ceiling ||
      (key === 'seats' && value < 1)
    )
      errors[key] = REQUIRED;
  }
  if (!form.tier) errors.tier = REQUIRED;
  return { errors, values };
}

/**
 * A plan's refusal in the console's words: a Stripe price that doesn't
 * exist (400), or Stripe not answering (503).
 */
export function planRefusal(error: unknown): {
  title: string;
  description: string;
} {
  if (error instanceof ApiError && error.status === 503) {
    return {
      title: 'Stripe didn’t answer',
      description:
        'The prices couldn’t be checked with Stripe just now. Nothing was saved. Try again in a moment.',
    };
  }
  if (error instanceof ApiError && error.status === 400) {
    const id = /price (\S+)/.exec(error.message)?.[1]?.replace(/[!.]$/, '');
    return {
      title: 'Stripe doesn’t know a price',
      description: id
        ? `Stripe has no price ${id}, or it has no single amount. Check its id in Stripe.`
        : error.message.replace(/!$/, '.'),
    };
  }
  return {
    title: 'Couldn’t save the plan',
    description: 'Something went wrong on our side. Try again in a moment.',
  };
}

/** A new plan: every grant required; its prices' amounts come after saving. */
export function PlanCreate() {
  return <PlanForm plan={null} />;
}

/** A plan's page: its catalog row to edit, Preview applying and Retire. */
export function PlanEdit({ planId }: { planId: string }) {
  const query = usePlatformControllerGetPlanV1(planId, {
    query: { retry: false },
  });
  const crumbs = [{ label: 'Plans', href: '/platform/plans' }];
  const plan = query.data?.data;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <ConsolePage crumbs={crumbs} title="Plan">
        <PageUnavailable back={{ href: '/platform/plans', label: 'Plans' }} />
      </ConsolePage>
    );
  }
  if (!plan) {
    return (
      <ConsolePage crumbs={crumbs} title="Plan">
        {query.isError ? (
          <LoadError what="the plan" onRetry={() => void query.refetch()} />
        ) : (
          <Loading what="the plan" className="h-96" />
        )}
      </ConsolePage>
    );
  }
  return <PlanForm key={plan.updatedAt} plan={plan} />;
}

function PlanForm({ plan }: { plan: SubscriptionPlanResponseDto | null }) {
  const editing = plan !== null;
  const [form, setForm] = useState<Form>(plan ? formOf(plan) : EMPTY);
  const [prices, setPrices] = useState<Price[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [missing, setMissing] = useState(false);
  const [refusal, setRefusal] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const activeId = useId();
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ['/api/v1/platform/plans'],
    });
    if (plan)
      void queryClient.invalidateQueries({
        queryKey: [`/api/v1/platform/plans/${plan.id}`],
      });
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const { errors: found, values } = grantsOf(form);
    if (!form.name.trim()) found.name = REQUIRED;
    setErrors(found);
    setMissing(!editing && Object.keys(found).length > 0);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      formRef.current?.querySelector<HTMLElement>(`#plan-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      if (plan) {
        const change: UpdatePlanDto = {
          ...values,
          name: form.name.trim(),
          isActive: form.isActive,
          ...(form.stripeProductId.trim()
            ? { stripeProductId: form.stripeProductId.trim() }
            : plan.stripeProductId
              ? { clearStripeProductId: true }
              : {}),
        };
        await platformControllerUpdatePlanV1(plan.id, change);
        toast.success(`${form.name.trim()} is saved`);
        invalidate();
        setBusy(false);
      } else {
        const created = await platformControllerCreatePlanV1({
          ...values,
          name: form.name.trim(),
          isActive: form.isActive,
          stripeProductId: form.stripeProductId.trim() || undefined,
          prices: prices
            .filter((price) => price.stripePriceId.trim())
            .map((price) => ({
              stripePriceId: price.stripePriceId.trim(),
              interval: price.interval,
            })),
        });
        invalidate();
        router.push(`/platform/plans/${created.data?.id ?? ''}`);
      }
    } catch (failed) {
      setBusy(false);
      if (failed instanceof ApiError && [400, 503].includes(failed.status)) {
        setRefusal(planRefusal(failed));
        return;
      }
      toastError('Couldn’t save the plan', planRefusal(failed).description);
    }
  };

  const grantBox = ({ key, label, unit, help }: (typeof GRANTS)[number]) => (
    <Field
      key={key}
      id={`plan-${key}`}
      label={label}
      description={errors[key] ? undefined : help}
      error={errors[key] ? `${errors[key]} ${help}` : undefined}
    >
      {(aria) => (
        <UnitInput
          id={`plan-${key}`}
          unit={unit}
          aria-label={unit ? `${label} (${unit})` : undefined}
          value={form[key]}
          onChange={(event) => set(key, event.target.value)}
          {...aria}
        />
      )}
    </Field>
  );

  const header = plan
    ? {
        title: plan.name,
        badge: plan.deletedAt ? undefined : (
          <PlanBadges
            stripeProductId={plan.stripeProductId}
            isActive={plan.isActive}
          />
        ),
        description: [
          count(plan.subscriberCount, 'subscriber'),
          plan.stripeProductId && `Stripe product ${plan.stripeProductId}`,
        ]
          .filter(Boolean)
          .join(' · '),
        actions: plan.deletedAt ? undefined : (
          <>
            <Link
              href={`/platform/plans/${plan.id}/apply`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <EyeIcon aria-hidden />
              Preview applying
            </Link>
            <Button
              variant="destructive-outline"
              onClick={() => setRetiring(true)}
            >
              <Trash2Icon aria-hidden />
              Retire
            </Button>
          </>
        ),
      }
    : {
        title: 'New plan',
        badge: undefined,
        description:
          'A plan with a Stripe product can be bought; without one, it’s assigned by the platform.',
        actions: undefined,
      };

  return (
    <ConsolePage
      crumbs={[
        { label: 'Plans', href: '/platform/plans' },
        { label: plan ? plan.name : 'New plan' },
      ]}
      {...header}
      className="max-w-5xl"
    >
      <Alert variant="info">
        <InfoIcon aria-hidden />
        {plan ? (
          <>
            <AlertTitle>Saving changes the catalog only</AlertTitle>
            <AlertDescription>
              {`${plan.name}’s ${count(plan.subscriberCount, 'subscriber')} ${plan.subscriberCount === 1 ? 'keeps what it has' : 'keep what they have'} until you apply it. After saving, preview what applying would change.`}
              {!plan.stripeProductId && plan.name !== 'Free' && (
                <p className="mt-1">
                  Nobody buys it: organizations get it when you assign it, from
                  an organization’s Plan and limits.
                </p>
              )}
            </AlertDescription>
          </>
        ) : (
          <>
            <AlertTitle>Nobody is on a new plan</AlertTitle>
            <AlertDescription>
              Organizations get it when they subscribe to it (with a Stripe
              product) or when you assign it.
            </AlertDescription>
          </>
        )}
      </Alert>
      {missing && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Fill in every grant</AlertTitle>
          <AlertDescription>
            A plan needs all of them before it can be created.
          </AlertDescription>
        </Alert>
      )}
      {refusal && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{refusal.title}</AlertTitle>
          <AlertDescription>{refusal.description}</AlertDescription>
        </Alert>
      )}
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <ConsoleCard title="The plan">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="plan-name" label="Name" error={errors.name}>
              {(aria) => (
                <Input
                  id="plan-name"
                  autoComplete="off"
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                  {...aria}
                />
              )}
            </Field>
            <Field
              id="plan-stripe"
              label="Stripe product (optional)"
              description="Leave it empty for an assigned plan (negotiated): nobody can buy it."
            >
              {(aria) => (
                <Input
                  id="plan-stripe"
                  autoComplete="off"
                  placeholder="prod_…"
                  className="font-mono"
                  value={form.stripeProductId}
                  onChange={(event) =>
                    set('stripeProductId', event.target.value)
                  }
                  {...aria}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={activeId}
              checked={form.isActive}
              onCheckedChange={(checked) => set('isActive', checked)}
            />
            <Label htmlFor={activeId}>Offered to organizations</Label>
          </div>
        </ConsoleCard>
        <ConsoleCard
          title="What it grants"
          lead={plan ? undefined : 'Every grant is required.'}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {GRANTS.map(grantBox)}
            <Field
              id="plan-tier"
              label="AI model"
              description={errors.tier ? undefined : 'Quality or Fast.'}
              error={errors.tier}
            >
              {(aria) => (
                <Select
                  value={form.tier}
                  onValueChange={(value) => set('tier', value as Form['tier'])}
                >
                  <SelectTrigger id="plan-tier" className="w-full" {...aria}>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="QUALITY">Quality</SelectItem>
                    <SelectItem value="FAST">Fast</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
        </ConsoleCard>
        <ConsoleCard
          title="Prices"
          lead={`Stripe’s prices for the product, by id and interval. Amounts come from Stripe. Up to ${MAX_PRICES}.`}
        >
          {plan ? (
            plan.prices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No prices yet. An assigned plan needs none.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Stripe price</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.prices.map((price) => (
                      <TableRow key={price.id}>
                        <TableCell className="font-mono">
                          {price.stripePriceId}
                        </TableCell>
                        <TableCell>
                          {price.interval === 'year' ? 'Yearly' : 'Monthly'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {priceLine(price).replace(/ a (month|year)$/, '')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <NewPrices prices={prices} onChange={setPrices} />
          )}
        </ConsoleCard>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Link
            href={plan ? '/platform/plans' : '/platform/plans'}
            className={buttonVariants({ variant: 'outline' })}
          >
            Cancel
          </Link>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {plan ? 'Save' : 'Create plan'}
          </Button>
        </div>
      </form>
      {plan && (
        <RetireDialog
          plan={plan}
          open={retiring}
          onOpenChange={setRetiring}
          onDone={(retired) => {
            invalidate();
            if (retired) router.push('/platform/plans');
          }}
        />
      )}
    </ConsolePage>
  );
}

/** The new plan's prices: a Stripe price id and its interval, up to twelve. */
function NewPrices({
  prices,
  onChange,
}: {
  prices: Price[];
  onChange: (prices: Price[]) => void;
}) {
  const update = (key: number, change: Partial<Price>) =>
    onChange(
      prices.map((price) =>
        price.key === key ? { ...price, ...change } : price,
      ),
    );
  return (
    <div className="flex flex-col gap-3">
      {prices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No prices yet. An assigned plan needs none.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {prices.map((price, index) => (
            <li key={price.key} className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label htmlFor={`price-${price.key}`}>
                  Stripe price <span className="sr-only">{index + 1}</span>
                </Label>
                <Input
                  id={`price-${price.key}`}
                  placeholder="price_…"
                  className="font-mono"
                  autoComplete="off"
                  value={price.stripePriceId}
                  onChange={(event) =>
                    update(price.key, { stripePriceId: event.target.value })
                  }
                />
              </div>
              <div className="flex w-36 flex-col gap-1.5">
                <Label htmlFor={`interval-${price.key}`}>Interval</Label>
                <Select
                  value={price.interval}
                  onValueChange={(value) =>
                    update(price.key, { interval: value as Price['interval'] })
                  }
                >
                  <SelectTrigger
                    id={`interval-${price.key}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove price ${index + 1}`}
                onClick={() =>
                  onChange(prices.filter((one) => one.key !== price.key))
                }
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {prices.length < MAX_PRICES && (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() =>
            onChange([
              ...prices,
              { key: Date.now(), stripePriceId: '', interval: 'month' },
            ])
          }
        >
          <PlusIcon aria-hidden />
          Add a price
        </Button>
      )}
    </div>
  );
}

/**
 * Retire: removed from the catalog when nobody is on it. While anyone is,
 * it's refused, and Deactivate is offered instead.
 */
function RetireDialog({
  plan,
  open,
  onOpenChange,
  onDone,
}: {
  plan: SubscriptionPlanResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (retired: boolean) => void;
}) {
  const [refused, setRefused] = useState(plan.subscriberCount > 0);
  const subscribers = plan.subscriberCount.toLocaleString('en-US');

  if (refused) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`${plan.name} can’t be retired`}
        description={
          plan.subscriberCount === 1
            ? '1 organization is on it. Deactivate it instead: it stops being offered, and that organization keeps it as it has it.'
            : `${subscribers} organizations are on it. Deactivate it instead: it stops being offered, and those ${subscribers} keep it as they have it.`
        }
        confirmLabel={`Deactivate ${plan.name}`}
        destructive={false}
        onConfirm={async () => {
          try {
            await platformControllerUpdatePlanV1(plan.id, { isActive: false });
            toast.success(`${plan.name} is no longer offered`);
            onDone(false);
          } catch (failed) {
            return planRefusal(failed);
          }
        }}
      />
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Retire ${plan.name}?`}
      description="It’s removed from the catalog. Nobody is on it."
      confirmLabel={`Retire ${plan.name}`}
      icon={Trash2Icon}
      onConfirm={async () => {
        try {
          await platformControllerDeletePlanV1(plan.id);
          toast.success(`${plan.name} is retired`);
          onDone(true);
        } catch (failed) {
          if (failed instanceof ApiError && failed.status === 409) {
            setRefused(true);
            return false;
          }
          return planRefusal(failed);
        }
      }}
    />
  );
}
