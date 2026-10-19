'use client';

import {
  ApiError,
  organizationsControllerUpdateV1,
  useOrganizationsControllerGetSettingsV1,
  useOrganizationsControllerGetUsageV1,
  useOrganizationsControllerGetV1,
  type OrganizationResponseDto,
} from '@synapsedesk/api-client';
import { ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { SectionCard } from '@/components/account/section-card';
import { serverMessage } from '@/components/ticket/use-directory';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useViewer } from '@/hooks/use-viewer';
import { asSentence } from '@/lib/documents';
import { dayDate } from '@/lib/format';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { OrganizationStatus } from './badges';
import { DangerZone } from './organization-danger';
import { InboundEmailCard } from './organization-inbound';
import { SecurityCard, UploadLimitsCard } from './organization-security';
import {
  LoadError,
  PageHeading,
  SettingsFrame,
  SettingsUnavailable,
} from './settings-frame';
import { useOrganizationCache } from './use-organization-cache';
import { UsageMeters } from './usage-meter';

/** The 409s that name a field, in the server's words. */
export const SLUG_TAKEN =
  'That address is already taken by another organization.';
export const DOMAIN_TAKEN =
  'That domain is already used by another organization.';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOMAIN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Settings › Organization: the profile, plan and usage, security, upload
 * limits, the inbound address and the danger zone, each by its permission.
 */
export function OrganizationView() {
  const { can, query: viewer } = useViewer();
  const organization = useOrganizationsControllerGetV1();
  const readable = can('organization.read');

  if (viewer.isSuccess && !readable) {
    return (
      <SettingsFrame crumbs={[{ label: 'Organization' }]}>
        <SettingsUnavailable />
      </SettingsFrame>
    );
  }

  const current = organization.data?.data;
  return (
    <SettingsFrame crumbs={[{ label: 'Organization' }]}>
      <PageHeading
        title="Organization"
        description={
          current
            ? `${current.name}’s profile, plan, security and integrations.`
            : undefined
        }
      />
      {current && readable ? (
        <div className="flex flex-col gap-6">
          <ProfileCard organization={current} />
          <UsageCard />
          <SettingsCards organization={current} />
          {can('organization.delete') && <DangerZone organization={current} />}
        </div>
      ) : (
        <div className="flex max-w-2xl flex-col gap-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </SettingsFrame>
  );
}

function SettingsCards({
  organization,
}: {
  organization: OrganizationResponseDto;
}) {
  const settings = useOrganizationsControllerGetSettingsV1();
  const current = settings.data?.data;
  if (!current) return <Skeleton className="h-64 w-full max-w-2xl" />;
  return (
    <>
      <SecurityCard organization={organization} settings={current} />
      <UploadLimitsCard organization={organization} settings={current} />
      <InboundEmailCard address={current.inboundAddress} />
    </>
  );
}

function ProfileCard({
  organization,
}: {
  organization: OrganizationResponseDto;
}) {
  const { can } = useViewer();
  const refresh = useOrganizationCache();
  const editable = can('organization.update');
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const [domain, setDomain] = useState(organization.domain ?? '');
  const [errors, setErrors] = useState<{
    slug?: string;
    domain?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const changed =
    name !== organization.name ||
    slug !== organization.slug ||
    domain !== (organization.domain ?? '');

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    if (!SLUG.test(slug)) {
      found.slug = 'Use lowercase letters, numbers and single hyphens.';
    }
    if (domain && !DOMAIN.test(domain)) {
      found.domain = `“${domain}” isn’t a valid domain.`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await organizationsControllerUpdateV1({
        ...(name === organization.name ? {} : { name: name.trim() }),
        ...(slug === organization.slug ? {} : { slug }),
        ...(domain === (organization.domain ?? '') ? {} : { domain }),
      });
      await refresh();
    } catch (error) {
      const sentence =
        error instanceof ApiError ? asSentence(error.message) : null;
      if (error instanceof ApiError && error.status === 409) {
        setErrors(
          sentence === DOMAIN_TAKEN
            ? { domain: DOMAIN_TAKEN }
            : { slug: sentence ?? SLUG_TAKEN },
        );
      } else {
        toastError('Couldn’t save the profile', serverMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Profile"
      badge={<OrganizationStatus status={organization.status} />}
      lead={`Everyone in ${organization.name} sees its name.`}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <Field id="organization-name" label="Name">
          {(aria) => (
            <Input
              id="organization-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              readOnly={!editable}
              maxLength={255}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="organization-slug"
          label="Address"
          description="Lowercase words joined by hyphens, like northwind-health."
          error={errors.slug}
          announce
        >
          {(aria) => (
            <Input
              id="organization-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              readOnly={!editable}
              maxLength={100}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="organization-domain"
          label="Domain"
          description="Your organization’s own web domain."
          error={errors.domain}
          announce
        >
          {(aria) => (
            <Input
              id="organization-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              readOnly={!editable}
              maxLength={255}
              {...aria}
            />
          )}
        </Field>
        {editable && (
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!changed || saving || name.trim().length < 2}
            >
              Save changes
            </Button>
          </div>
        )}
      </form>
    </SectionCard>
  );
}

/** The month after a cycle's start: when the AI allowance resets. */
function UsageCard() {
  const usage = useOrganizationsControllerGetUsageV1();
  const current = usage.data?.data;
  const retry = () => void usage.refetch();
  return (
    <section aria-labelledby="usage-heading" className="max-w-2xl">
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <header className="flex items-center justify-between gap-3">
          <h2 id="usage-heading" className="text-base font-semibold">
            Plan and usage
          </h2>
          <Link
            href="/settings/billing"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <span className="hidden sm:inline">Plans and billing</span>
            <span className="sm:hidden">Billing</span>
            <ChevronRightIcon aria-hidden />
          </Link>
        </header>
        {current ? (
          <>
            <UsageMeters usage={current} onRetry={retry} withNotes />
            <p className={cn('text-sm text-muted-foreground')}>
              {[
                `${current.planName} plan`,
                current.aiModelTier === 'QUALITY'
                  ? 'Quality model'
                  : 'Fast model',
                `billing cycle started ${dayDate(current.billingCycleStart)}`,
              ].join(' · ')}
            </p>
          </>
        ) : usage.isError ? (
          <LoadError what="the usage" onRetry={retry} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </div>
    </section>
  );
}
