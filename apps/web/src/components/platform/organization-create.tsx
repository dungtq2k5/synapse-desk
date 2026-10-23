'use client';

import {
  ApiError,
  usePlatformControllerCreateOrganizationV1,
  type CreatePlatformOrganizationResponseDto,
} from '@synapsedesk/api-client';
import { ORGANIZATION_SLUG_PATTERN } from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheckIcon, MailIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMAIL } from '@/lib/sign-in';
import { toastError } from '@/lib/toast';
import { ConsoleStatusBadge } from './badges';
import { ConsoleCard, ConsolePage, Facts } from './console-page';
import { bytesOf, microsOf, UnitInput, wholeOf } from './fields';

const CRUMBS = [
  { label: 'Organizations', href: '/platform/organizations' },
  { label: 'New organization' },
];

const TAKEN_ADDRESS = 'That address is already taken by another organization.';
const TAKEN_DOMAIN = 'That domain is already used by another organization.';
const SLUG_RULE = 'Lowercase letters, digits and hyphens only.';
const REQUIRED = 'Required.';

type Form = {
  name: string;
  slug: string;
  domain: string;
  allowedEmailDomains: string;
  adminFullName: string;
  adminEmail: string;
  seats: string;
  storage: string;
  ai: string;
};

const EMPTY: Form = {
  name: '',
  slug: '',
  domain: '',
  allowedEmailDomains: '',
  adminFullName: '',
  adminEmail: '',
  seats: '',
  storage: '',
  ai: '',
};

type Errors = Partial<Record<keyof Form, string>>;

/** The form's own checks, in its order: the first one gets the focus. */
export function check(form: Form): Errors {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = REQUIRED;
  if (!form.slug.trim()) errors.slug = REQUIRED;
  else if (!ORGANIZATION_SLUG_PATTERN.test(form.slug.trim()))
    errors.slug = SLUG_RULE;
  if (!form.adminFullName.trim()) errors.adminFullName = REQUIRED;
  if (!EMAIL.test(form.adminEmail.trim()))
    errors.adminEmail = 'Enter an email address like name@company.com.';
  if (Number.isNaN(wholeOf(form.seats))) errors.seats = 'Enter a whole number.';
  if (Number.isNaN(bytesOf(form.storage)))
    errors.storage = 'Enter a number of GB.';
  if (Number.isNaN(microsOf(form.ai))) errors.ai = 'Enter an amount in USD.';
  return errors;
}

/**
 * A 409's field, from the server's sentence: the address or the domain. The
 * deck's words are shown, never the server's.
 */
export function conflictField(message: string): 'slug' | 'domain' {
  return /domain/i.test(message) ? 'domain' : 'slug';
}

/**
 * Create an organization and its first Org Admin, who is emailed a link to
 * set a password. Each refusal is marked under the field it's about; there's
 * no alert above the form.
 */
export function OrganizationCreate() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] =
    useState<CreatePlatformOrganizationResponseDto | null>(null);
  const create = usePlatformControllerCreateOrganizationV1();
  const queryClient = useQueryClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const set = (key: keyof Form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const focusFirst = (found: Errors) => {
    const first = Object.keys(found)[0];
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return focusFirst(found);
    try {
      const answer = await create.mutateAsync({
        data: {
          name: form.name.trim(),
          slug: form.slug.trim(),
          domain: form.domain.trim() || undefined,
          allowedEmailDomains: form.allowedEmailDomains
            .split(/[\s,]+/)
            .map((domain) => domain.trim())
            .filter(Boolean),
          adminFullName: form.adminFullName.trim(),
          adminEmail: form.adminEmail.trim(),
          maxAgentSeats: wholeOf(form.seats) ?? undefined,
          maxStorageBytes: bytesOf(form.storage) ?? undefined,
          monthlyAiTokenBudget: microsOf(form.ai) ?? undefined,
        },
      });
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/organizations'],
      });
      setCreated(answer.data ?? null);
      globalThis.scrollTo?.(0, 0);
    } catch (failed) {
      if (failed instanceof ApiError && failed.status === 409) {
        const field = conflictField(failed.message);
        const next = {
          [field]: field === 'slug' ? TAKEN_ADDRESS : TAKEN_DOMAIN,
        };
        setErrors(next);
        focusFirst(next);
        return;
      }
      if (failed instanceof ApiError && failed.status === 400) {
        const next = /slug/i.test(failed.message) ? { slug: SLUG_RULE } : {};
        if (Object.keys(next).length) {
          setErrors(next);
          focusFirst(next);
          return;
        }
      }
      toastError(
        'Couldn’t create the organization',
        'Something went wrong on our side. Try again in a moment.',
      );
    }
  };

  if (created) {
    return (
      <Created
        created={created}
        onAnother={() => {
          setForm(EMPTY);
          setErrors({});
          setCreated(null);
        }}
        onOpen={(id) => router.push(`/platform/organizations/${id}`)}
      />
    );
  }

  const field = (
    key: keyof Form,
    label: string,
    options: {
      description?: string;
      type?: string;
      autoComplete?: string;
    } = {},
  ) => (
    <Field
      id={key}
      label={label}
      description={options.description}
      error={errors[key]}
    >
      {(aria) => (
        <Input
          id={key}
          type={options.type}
          autoComplete={options.autoComplete ?? 'off'}
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
    unit?: string,
  ) => (
    <Field id={key} label={label} error={errors[key]}>
      {(aria) => (
        <UnitInput
          id={key}
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
      crumbs={CRUMBS}
      title="New organization"
      description="Create an organization and its first Org Admin. It starts as Setting up."
      className="max-w-4xl"
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
      >
        <ConsoleCard title="The organization">
          <div className="grid gap-4 md:grid-cols-2">
            {field('name', 'Name')}
            {field('slug', 'Address', {
              description:
                'Lowercase letters, digits and hyphens. Its people sign in at this address.',
            })}
            {field('domain', 'Domain (optional)')}
            {field('allowedEmailDomains', 'Allowed email domains (optional)', {
              description:
                'People who sign up with these join it automatically, as End Users.',
            })}
          </div>
        </ConsoleCard>
        <ConsoleCard
          title="Its first Org Admin"
          lead="The person who sets the organization up. Nobody else can sign in to it yet."
        >
          <div className="grid gap-4 md:grid-cols-2">
            {field('adminFullName', 'Full name', { autoComplete: 'off' })}
            {field('adminEmail', 'Email', { type: 'email' })}
          </div>
          <Alert variant="info">
            <MailIcon aria-hidden />
            <AlertTitle>They’ll get an email to set a password</AlertTitle>
            <AlertDescription>
              The admin has no password yet. We send them a link to set one,
              then they can sign in and invite their team.
            </AlertDescription>
          </Alert>
        </ConsoleCard>
        <ConsoleCard
          title="Limits"
          lead="Optional. A new organization starts as Setting up, on Free’s limits."
        >
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>
              Stripe sets these once the organization subscribes
            </AlertTitle>
            <AlertDescription>
              Anything set here is an override: the next Stripe event for this
              organization (a subscription, a renewal) replaces it with the
              plan’s limits. Leave them empty to start on Free’s.
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 md:grid-cols-3">
            {limit('seats', 'Seats')}
            {limit('storage', 'Document storage', 'GB')}
            {limit('ai', 'AI allowance a month', 'USD')}
          </div>
        </ConsoleCard>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Link
            href="/platform/organizations"
            className={buttonVariants({ variant: 'outline' })}
          >
            Cancel
          </Link>
          <Button
            type="submit"
            disabled={create.isPending}
            aria-busy={create.isPending || undefined}
          >
            {create.isPending ? 'Creating…' : 'Create organization'}
          </Button>
        </div>
      </form>
    </ConsolePage>
  );
}

/** Created: what happens next, and where to go. */
function Created({
  created,
  onAnother,
  onOpen,
}: {
  created: CreatePlatformOrganizationResponseDto;
  onAnother: () => void;
  onOpen: (id: string) => void;
}) {
  const organization = created.organization.organization;
  const admin = created.admin;
  const first = admin.fullName.split(' ')[0] ?? admin.fullName;
  return (
    <ConsolePage
      crumbs={CRUMBS}
      title={`${organization.name} is created`}
      description="It’s Setting up, on Free’s limits."
    >
      <Alert variant="success" role="status">
        <CircleCheckIcon aria-hidden />
        <AlertTitle>{`${organization.name} is created`}</AlertTitle>
        <AlertDescription>
          {`We emailed ${admin.fullName} a link to set a password.`}
        </AlertDescription>
      </Alert>
      <ConsoleCard title="What happens next">
        <Facts
          rows={[
            ['Address', organization.slug],
            [
              'Status',
              <ConsoleStatusBadge key="s" status="PENDING_ONBOARDING" />,
            ],
            ['Org Admin', `${admin.fullName} · ${admin.email}`],
            ['Password', `${first} gets an email with a link to set one.`],
          ]}
        />
        <div className="flex flex-col gap-2 md:flex-row md:justify-end">
          <Button onClick={() => onOpen(organization.id)}>
            {`Open ${organization.name}`}
          </Button>
          <Button variant="outline" onClick={onAnother}>
            Create another
          </Button>
        </div>
      </ConsoleCard>
    </ConsolePage>
  );
}
