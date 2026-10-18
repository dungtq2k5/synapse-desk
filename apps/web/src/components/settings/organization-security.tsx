'use client';

import {
  organizationsControllerUpdateSettingsV1,
  useUserAdminControllerListV1,
  type OrganizationResponseDto,
  type OrganizationSettingsResponseDto,
} from '@synapsedesk/api-client';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
} from '@synapsedesk/contracts';
import { ShieldCheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { SectionCard } from '@/components/account/section-card';
import { serverMessage } from '@/components/ticket/use-directory';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useViewer } from '@/hooks/use-viewer';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useOrganizationCache } from './use-organization-cache';

const MB = 1024 * 1024;

const DOMAIN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The mail provider a public domain belongs to, for the warning. */
const PROVIDERS: [RegExp, string][] = [
  [/^(gmail|googlemail)\./, 'Gmail'],
  [/^(outlook|hotmail|live|msn)\./, 'Outlook'],
  [/^yahoo\./, 'Yahoo'],
  [/^(icloud|me|mac)\.com$/, 'iCloud'],
  [/^(proton|protonmail)\./, 'Proton'],
  [/^aol\./, 'AOL'],
];

function provider(domain: string): string {
  return PROVIDERS.find(([pattern]) => pattern.test(domain))?.[1] ?? domain;
}

/** Who joins automatically, and whether everyone needs two-step. */
export function SecurityCard({
  organization,
  settings,
}: {
  organization: OrganizationResponseDto;
  settings: OrganizationSettingsResponseDto;
}) {
  const { can } = useViewer();
  const refresh = useOrganizationCache();
  const editable = can('organization.update');
  const [enforce, setEnforce] = useState(settings.enforceTwoFactor);
  const [domains, setDomains] = useState(settings.allowedEmailDomains);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState(settings.publicDomainWarnings);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const switchId = useId();
  const domainsId = useId();

  const changed =
    enforce !== settings.enforceTwoFactor ||
    domains.join() !== settings.allowedEmailDomains.join();

  const add = () => {
    const domain = draft.trim().toLowerCase();
    if (!domain) return;
    if (!DOMAIN.test(domain)) {
      setDraftError(`“${domain}” isn’t a valid domain.`);
      return;
    }
    setDraftError(null);
    setDraft('');
    if (!domains.includes(domain)) setDomains([...domains, domain]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && domains.length > 0) {
      setDomains(domains.slice(0, -1));
    }
  };

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const answer = await organizationsControllerUpdateSettingsV1({
        ...(enforce === settings.enforceTwoFactor
          ? {}
          : { enforceTwoFactor: enforce }),
        allowedEmailDomains: domains,
      });
      setWarnings(answer.data?.publicDomainWarnings ?? []);
      await refresh();
    } catch (error) {
      toastError('Couldn’t save security settings', serverMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Security"
      lead="Who joins automatically, and how everyone signs in."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Switch
              id={switchId}
              checked={enforce}
              disabled={!editable}
              aria-describedby={`${switchId}-help`}
              onCheckedChange={(on) =>
                on ? setConfirming(true) : setEnforce(false)
              }
            />
            <Label htmlFor={switchId}>
              Require two-step verification for everyone
            </Label>
          </div>
          <p id={`${switchId}-help`} className="text-sm text-muted-foreground">
            Members without it will have to set it up the next time they sign
            in.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={domainsId}>Allowed email domains</Label>
          <div
            className={cn(
              'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
              !editable && 'bg-muted',
            )}
          >
            {domains.map((domain) => {
              const warned = warnings.includes(domain);
              return (
                <span
                  key={domain}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    warned
                      ? 'border border-warning-border bg-warning-subtle text-warning-subtle-foreground'
                      : 'bg-muted text-foreground',
                  )}
                >
                  {warned && (
                    <TriangleAlertIcon aria-hidden className="size-3" />
                  )}
                  {domain}
                  {editable && (
                    <button
                      type="button"
                      aria-label={`Remove ${domain}`}
                      className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() =>
                        setDomains(domains.filter((each) => each !== domain))
                      }
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  )}
                </span>
              );
            })}
            {editable && (
              <input
                id={domainsId}
                value={draft}
                placeholder="Add a domain"
                aria-describedby={`${domainsId}-help${draftError ? ` ${domainsId}-error` : ''}`}
                aria-invalid={draftError ? true : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onBlur={add}
                className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            )}
          </div>
          <p id={`${domainsId}-help`} className="text-sm text-muted-foreground">
            Anyone who signs up with an address at these domains joins{' '}
            {organization.name} automatically, as an End User. You can still
            invite people from any domain.
          </p>
          {draftError && (
            <p id={`${domainsId}-error`} className="text-sm text-destructive">
              {draftError}
            </p>
          )}
        </div>
        {warnings
          .filter((domain) => domains.includes(domain))
          .map((domain) => (
            <Alert
              key={domain}
              className="border-warning-border bg-warning-subtle text-warning-subtle-foreground"
            >
              <TriangleAlertIcon aria-hidden />
              <AlertTitle>{domain} is a public email domain</AlertTitle>
              <AlertDescription className="text-warning-subtle-foreground">
                Anyone who signs up with a {provider(domain)} address would join{' '}
                {organization.name}. Remove it unless that’s what you want.
              </AlertDescription>
            </Alert>
          ))}
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" disabled={!changed || saving}>
              Save changes
            </Button>
          </div>
        )}
      </form>
      <RequireTwoStepDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setEnforce(true);
          setConfirming(false);
        }}
      />
    </SectionCard>
  );
}

/** "Require two-step verification for everyone?", with who it affects. */
function RequireTwoStepDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { can } = useViewer();
  // ponytail: the first 100 members; past that the count reads low. A count
  // the server answers would be exact.
  const members = useUserAdminControllerListV1(
    { limit: 100 },
    { query: { enabled: open && can('user.read') } },
  );
  const page = members.data?.data;
  const without = page?.items.filter(
    (item) => !item.user.isTwoFactorEnabled,
  ).length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Require two-step verification for everyone?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Members without it will have to set it up the next time they sign
            in.
            {page && without !== undefined
              ? ` ${without} of ${page.meta.totalItems} don’t have it yet.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <Button onClick={onConfirm}>
            <ShieldCheckIcon aria-hidden />
            Require it
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Limit = {
  key:
    | 'maxDocumentBytesOverride'
    | 'maxAttachmentBytesOverride'
    | 'maxAttachmentsPerMessageOverride';
  label: string;
  help: string;
  /** The product's own limit, in the field's unit. */
  ceiling: number;
  /** Bytes shown as MB; a count as itself. */
  megabytes: boolean;
};

const LIMITS: Limit[] = [
  {
    key: 'maxDocumentBytesOverride',
    label: 'Largest document',
    help: `Up to ${MAX_DOCUMENT_BYTES / MB} MB, the product’s limit. Leave it empty to use that.`,
    ceiling: MAX_DOCUMENT_BYTES / MB,
    megabytes: true,
  },
  {
    key: 'maxAttachmentBytesOverride',
    label: 'Largest attachment',
    help: `Up to ${MAX_ATTACHMENT_BYTES / MB} MB, the product’s limit.`,
    ceiling: MAX_ATTACHMENT_BYTES / MB,
    megabytes: true,
  },
  {
    key: 'maxAttachmentsPerMessageOverride',
    label: 'Attachments per message',
    help: `Up to ${MAX_ATTACHMENTS_PER_MESSAGE}, the product’s limit.`,
    ceiling: MAX_ATTACHMENTS_PER_MESSAGE,
    megabytes: false,
  },
];

function shown(limit: Limit, value: number | null): string {
  if (value === null) return '';
  return String(limit.megabytes ? Math.round(value / MB) : value);
}

/** The three caps, each below the product's own. */
export function UploadLimitsCard({
  organization,
  settings,
}: {
  organization: OrganizationResponseDto;
  settings: OrganizationSettingsResponseDto;
}) {
  const { can } = useViewer();
  const refresh = useOrganizationCache();
  const editable = can('organization.update');
  const [values, setValues] = useState<Record<Limit['key'], string>>(() => ({
    maxDocumentBytesOverride: shown(
      LIMITS[0],
      settings.maxDocumentBytesOverride,
    ),
    maxAttachmentBytesOverride: shown(
      LIMITS[1],
      settings.maxAttachmentBytesOverride,
    ),
    maxAttachmentsPerMessageOverride: shown(
      LIMITS[2],
      settings.maxAttachmentsPerMessageOverride,
    ),
  }));
  const [errors, setErrors] = useState<Partial<Record<Limit['key'], string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const changed = LIMITS.some(
    (limit) => values[limit.key] !== shown(limit, settings[limit.key]),
  );

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    const body: Partial<Record<Limit['key'], number | null>> = {};
    for (const limit of LIMITS) {
      const text = values[limit.key].trim();
      if (text === shown(limit, settings[limit.key])) continue;
      if (!text) {
        body[limit.key] = null;
        continue;
      }
      const number = Number(text);
      if (!Number.isInteger(number) || number < 1 || number > limit.ceiling) {
        found[limit.key] =
          `Choose ${limit.ceiling}${limit.megabytes ? ' MB' : ''} or less.`;
        continue;
      }
      body[limit.key] = limit.megabytes ? number * MB : number;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await organizationsControllerUpdateSettingsV1(body);
      await refresh();
    } catch (error) {
      toastError('Couldn’t save upload limits', serverMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Upload limits"
      lead={`Lower the product’s limits for ${organization.name}. Empty means the product’s own.`}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => void save(event)}
        noValidate
      >
        {LIMITS.map((limit) => (
          <Field
            key={limit.key}
            id={limit.key}
            label={limit.label}
            description={limit.help}
            error={errors[limit.key]}
          >
            {(aria) => (
              <div className="relative">
                <Input
                  id={limit.key}
                  inputMode="numeric"
                  value={values[limit.key]}
                  readOnly={!editable}
                  onChange={(event) =>
                    setValues({ ...values, [limit.key]: event.target.value })
                  }
                  className={cn(limit.megabytes && 'pr-12')}
                  {...aria}
                />
                {limit.megabytes && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                  >
                    MB
                  </span>
                )}
              </div>
            )}
          </Field>
        ))}
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" disabled={!changed || saving}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </SectionCard>
  );
}
