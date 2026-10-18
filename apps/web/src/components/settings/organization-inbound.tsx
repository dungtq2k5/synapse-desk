'use client';

import {
  organizationsControllerIssueInboundTokenV1,
  organizationsControllerRevokeInboundTokenV1,
} from '@synapsedesk/api-client';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  PowerIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useState } from 'react';
import { SectionCard } from '@/components/account/section-card';
import { serverMessage } from '@/components/ticket/use-directory';
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
import { useViewer } from '@/hooks/use-viewer';
import { toastError } from '@/lib/toast';
import { Status } from './badges';
import { CopyField } from './copy-field';
import { useOrganizationCache } from './use-organization-cache';

type Confirm = 'rotate' | 'off' | null;

/**
 * The address that turns mail into tickets: off, or on with Copy, Rotate and
 * Turn off. Rotating and turning off drop the old address at once, so each
 * asks first.
 */
export function InboundEmailCard({ address }: { address: string | null }) {
  const { can } = useViewer();
  const refresh = useOrganizationCache();
  const editable = can('organization.update');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    try {
      await organizationsControllerIssueInboundTokenV1();
      await refresh();
      setConfirm(null);
    } catch (error) {
      toastError('Couldn’t change the inbound address', serverMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await organizationsControllerRevokeInboundTokenV1();
      await refresh();
      setConfirm(null);
    } catch (error) {
      toastError('Couldn’t turn off inbound email', serverMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Inbound email"
      badge={
        address ? (
          <Status tone="success" icon={CircleCheckIcon}>
            On
          </Status>
        ) : (
          <Status tone="muted" icon={CircleDashedIcon}>
            Off
          </Status>
        )
      }
      lead="Emails sent to this address become tickets."
    >
      {address ? (
        <div className="flex flex-col gap-4">
          <CopyField label="Inbound email address" value={address} />
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setConfirm('rotate')}>
                <RefreshCwIcon aria-hidden />
                Rotate address
              </Button>
              <Button variant="ghost" onClick={() => setConfirm('off')}>
                <PowerIcon aria-hidden />
                Turn off
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Off. Turn it on to get an address that turns emails into tickets.
          </p>
          {editable && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void turnOn()}
            >
              <PowerIcon aria-hidden />
              Turn on
            </Button>
          )}
        </div>
      )}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'rotate'
                ? 'Rotate the inbound address?'
                : 'Turn off inbound email?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'rotate'
                ? 'The current address stops working at once, and mail already on its way to it is dropped. Anything that forwards to it needs the new address.'
                : 'The address stops working at once, and mail already on its way to it is dropped. Turning it on again gives a new address.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void (confirm === 'rotate' ? turnOn() : turnOff())}
            >
              {confirm === 'rotate' ? (
                <RefreshCwIcon aria-hidden />
              ) : (
                <PowerIcon aria-hidden />
              )}
              {confirm === 'rotate' ? 'Rotate address' : 'Turn off'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
