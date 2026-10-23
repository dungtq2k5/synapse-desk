'use client';

import {
  ApiError,
  platformControllerUpdateOrganizationV1,
  usePlatformControllerGetOrganizationV1,
  usePlatformControllerListPlansV1,
  type PlatformOrganizationDetailResponseDto,
  type SubscriptionPlanResponseDto,
  type UpdatePlatformOrganizationDto,
} from '@synapsedesk/api-client';
import { ORGANIZATION_SLUG_PATTERN } from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { PageUnavailable } from '@/components/shell/page-unavailable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { aiMoney } from '@/lib/billing';
import { fileSize } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { ConsoleCard, ConsolePage } from './console-page';
import { conflictField } from './organization-create';
import { bytesOf, gbOf, microsOf, UnitInput, usdOf, wholeOf } from './fields';

type Form = {
  name: string;
  slug: string;
  domain: string;
  seats: string;
  storage: string;
  ai: string;
};
type Errors = Partial<Record<keyof Form, string>>;

/**
 * Edit an organization: its profile, and its limits as a break-glass
 * override, each saying what the plan grants. Only what changed is sent.
 */
export function OrganizationEdit({
  organizationId,
}: {
  organizationId: string;
}) {
  const detail = usePlatformControllerGetOrganizationV1(organizationId, {
    query: { retry: false },
  });
  const crumbs = [{ label: 'Organizations', href: '/platform/organizations' }];
  const data = detail.data?.data;
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <ConsolePage crumbs={crumbs} title="Edit">
        <PageUnavailable
          back={{ href: '/platform/organizations', label: 'Organizations' }}
        />
      </ConsolePage>
    );
  }
  if (!data) {
    return (
      <ConsolePage crumbs={crumbs} title="Edit">
        {detail.isError ? (
          <LoadError
            what="the organization"
            onRetry={() => void detail.refetch()}
          />
        ) : (
          <Loading what="the organization" className="h-96" />
        )}
      </ConsolePage>
    );
  }
  return <EditForm data={data} />;
}

function EditForm({ data }: { data: PlatformOrganizationDetailResponseDto }) {
  const organization = data.organization;
  const initial: Form = {
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain ?? '',
    seats: String(organization.maxAgentSeats),
    storage: gbOf(organization.maxStorageBytes),
    ai: usdOf(organization.monthlyAiTokenBudget),
  };
  const [form, setForm] = useState(initial);
  const [pinned, setPinned] = useState(data.entitlementsPinned);
  const pinId = useId();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const plans = usePlatformControllerListPlansV1(
    { limit: 100, includeInactive: true },
    { query: { enabled: Boolean(data.planName) } },
  );
  const plan = plans.data?.data?.items.find(
    (one) => one.name === data.planName,
  );
  const back = `/platform/organizations/${organization.id}`;
  const set = (key: keyof Form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const focus = (found: Errors) => {
    const first = Object.keys(found)[0];
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#edit-${first}`)?.focus();
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: Errors = {};
    if (!form.name.trim()) found.name = 'Required.';
    if (!ORGANIZATION_SLUG_PATTERN.test(form.slug.trim()))
      found.slug = 'Lowercase letters, digits and hyphens only.';
    const seats = wholeOf(form.seats);
    const storage = bytesOf(form.storage);
    const ai = microsOf(form.ai);
    if (seats === null || Number.isNaN(seats))
      found.seats = 'Enter a whole number.';
    if (storage === null || Number.isNaN(storage))
      found.storage = 'Enter a number of GB.';
    if (ai === null || Number.isNaN(ai)) found.ai = 'Enter an amount in USD.';
    setErrors(found);
    if (Object.keys(found).length) return focus(found);

    const change: UpdatePlatformOrganizationDto = {};
    if (form.name.trim() !== initial.name) change.name = form.name.trim();
    if (form.slug.trim() !== initial.slug) change.slug = form.slug.trim();
    if (form.domain.trim() && form.domain.trim() !== initial.domain)
      change.domain = form.domain.trim();
    if (form.seats !== initial.seats) change.maxAgentSeats = seats ?? undefined;
    if (form.storage !== initial.storage)
      change.maxStorageBytes = storage ?? undefined;
    if (form.ai !== initial.ai) change.monthlyAiTokenBudget = ai ?? undefined;
    if (pinned !== data.entitlementsPinned) change.entitlementsPinned = pinned;
    if (Object.keys(change).length === 0) return router.push(back);

    setBusy(true);
    try {
      await platformControllerUpdateOrganizationV1(organization.id, change);
      void queryClient.invalidateQueries({
        queryKey: [`/api/v1/platform/organizations/${organization.id}`],
      });
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/organizations'],
      });
      toast.success(`${form.name.trim()} is saved`);
      router.push(back);
    } catch (failed) {
      setBusy(false);
      if (failed instanceof ApiError && failed.status === 409) {
        const field = conflictField(failed.message);
        const next: Errors = {
          [field]:
            field === 'slug'
              ? 'That address is already taken by another organization.'
              : 'That domain is already used by another organization.',
        };
        setErrors(next);
        return focus(next);
      }
      toastError(
        'Couldn’t save the changes',
        'Something went wrong on our side. Try again in a moment.',
      );
    }
  };

  const text = (
    key: 'name' | 'slug' | 'domain',
    label: string,
    description?: string,
  ) => (
    <Field
      id={`edit-${key}`}
      label={label}
      description={description}
      error={errors[key]}
    >
      {(aria) => (
        <Input
          id={`edit-${key}`}
          autoComplete="off"
          value={form[key]}
          onChange={(event) => set(key)(event.target.value)}
          {...aria}
        />
      )}
    </Field>
  );
  const limit = (
    key: 'seats' | 'storage' | 'ai',
    label: string,
    grants: string | null,
    unit?: string,
  ) => (
    <Field
      id={`edit-${key}`}
      label={label}
      description={
        grants && plan ? `${plan.name} grants ${grants}.` : undefined
      }
      error={errors[key]}
    >
      {(aria) => (
        <UnitInput
          id={`edit-${key}`}
          unit={unit}
          aria-label={unit ? `${label} (${unit})` : undefined}
          value={form[key]}
          onChange={(event) => set(key)(event.target.value)}
          {...aria}
        />
      )}
    </Field>
  );

  return (
    <ConsolePage
      crumbs={[
        { label: 'Organizations', href: '/platform/organizations' },
        { label: organization.name, href: back },
        { label: 'Edit' },
      ]}
      title={`Edit ${organization.name}`}
      description="Its profile, and its limits as a temporary override."
      className="max-w-4xl"
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <ConsoleCard title="Profile">
          <div className="grid gap-4 md:grid-cols-2">
            {text('name', 'Name')}
            {text(
              'slug',
              'Address',
              'Changing it changes where its people sign in.',
            )}
            <div className="md:col-span-2">{text('domain', 'Domain')}</div>
          </div>
        </ConsoleCard>
        <div id="limits">
          <ConsoleCard
            title="Limits (override)"
            lead="Break glass. Each field says what the plan grants."
          >
            {data.billedThroughStripe && data.planName && (
              <Alert variant="warning">
                <TriangleAlertIcon aria-hidden />
                <AlertTitle>Stripe sets these</AlertTitle>
                <AlertDescription>
                  {`${organization.name} is on ${data.planName} through Stripe. A change here is an override: its next Stripe event (a renewal, a plan change) puts ${data.planName}’s limits back. Use it to unblock someone today, not to change their plan.`}
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              {limit('seats', 'Seats', grant(plan, 'seats'))}
              {limit(
                'storage',
                'Document storage',
                grant(plan, 'storage'),
                'GB',
              )}
              {limit('ai', 'AI allowance a month', grant(plan, 'ai'), 'USD')}
            </div>
            <div className="flex items-start gap-3">
              <Switch
                id={pinId}
                checked={pinned}
                onCheckedChange={setPinned}
                aria-describedby={`${pinId}-help`}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor={pinId}>
                  Keep these limits when Stripe’s events arrive
                </Label>
                <p
                  id={`${pinId}-help`}
                  className="text-sm text-muted-foreground"
                >
                  Neither Stripe’s events nor applying its plan change them
                  until this is turned off.
                </p>
              </div>
            </div>
          </ConsoleCard>
        </div>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Link href={back} className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Save changes
          </Button>
        </div>
      </form>
    </ConsolePage>
  );
}

function grant(
  plan: SubscriptionPlanResponseDto | undefined,
  what: 'seats' | 'storage' | 'ai',
): string | null {
  if (!plan) return null;
  if (what === 'seats') return plan.maxAgentSeats.toLocaleString('en-US');
  if (what === 'storage') return fileSize(plan.maxStorageBytes);
  return aiMoney(plan.monthlyAiTokenBudget, 'en-US');
}
