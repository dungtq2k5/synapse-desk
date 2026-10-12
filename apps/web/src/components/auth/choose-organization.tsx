'use client';

import {
  authControllerLoginWithTenantV1,
  type TenantOptionResponseDto,
} from '@synapsedesk/api-client';
import {
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { deviceName, signInStep, type SignInStep } from '@/lib/sign-in';
import { AuthCard } from './auth-card';

/** The email belongs to several organizations: pick the one to sign in to. */
export function ChooseOrganization({
  email,
  tenants,
  onAnswer,
  onBack,
}: {
  email: string;
  tenants: TenantOptionResponseDto[];
  onAnswer: (step: SignInStep) => void;
  onBack: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [failed, setFailed] = useState<TenantOptionResponseDto | null>(null);

  const choose = async (tenant: TenantOptionResponseDto) => {
    if (chosen !== null) return;
    setChosen(tenant.organizationId);
    setFailed(null);
    try {
      const answer = await authControllerLoginWithTenantV1({
        organizationId: tenant.organizationId,
        deviceName: deviceName(navigator.userAgent),
      });
      if (!answer.data) throw new Error('The sign-in answer had no data');
      onAnswer(signInStep(answer.data));
    } catch {
      setChosen(null);
      setFailed(tenant);
    }
  };

  return (
    <AuthCard
      title="Choose an organization"
      lead={`${email.trim()} belongs to more than one organization. Choose the one to sign in to.`}
    >
      {failed && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t sign in to {failed.name}</AlertTitle>
          <AlertDescription>
            Try again, or choose another organization.
          </AlertDescription>
        </Alert>
      )}
      <ul className="flex flex-col gap-2">
        {tenants.map((tenant, index) => {
          const busy = chosen === tenant.organizationId;
          return (
            <li key={tenant.organizationId}>
              <Button
                variant="outline"
                autoFocus={index === 0}
                aria-busy={busy || undefined}
                // The chosen one spins; the others dim while it signs in.
                disabled={chosen !== null && !busy}
                className="h-auto w-full justify-between px-4 py-3 text-left"
                onClick={() => void choose(tenant)}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{tenant.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {tenant.slug}
                  </span>
                </span>
                {busy ? (
                  <LoaderCircleIcon className="motion-safe:animate-spin" />
                ) : (
                  <ChevronRightIcon />
                )}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button variant="link" className="h-auto self-start p-0" onClick={onBack}>
        Back to sign in
      </Button>
    </AuthCard>
  );
}
