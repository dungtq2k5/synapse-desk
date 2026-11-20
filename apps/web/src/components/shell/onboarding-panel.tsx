'use client';

import {
  ApiError,
  getOrganizationsControllerGetOnboardingV1QueryKey,
  getOrganizationsControllerGetV1QueryKey,
  organizationsControllerCompleteOnboardingV1,
  useOrganizationsControllerGetOnboardingV1,
  useOrganizationsControllerGetV1,
  type OnboardingStepResponseDto,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleIcon,
  InfoIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useViewer } from '@/hooks/use-viewer';
import { toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Where each step is done. `href` null: that area isn't built yet, so the
 * action is shown disabled, saying so.
 */
const ACTIONS: Record<string, { label: string; href: string | null }> = {
  verify_email: {
    label: 'Verify email',
    href: '/verify-email?next=%2Ftickets',
  },
  create_department: { label: 'Go to Departments', href: null },
  invite_team: { label: 'Go to Invitations', href: null },
};

/**
 * The founder's setup checklist, at the top of the first page while the
 * organization is still being set up. The server decides who sees it (a 403
 * is anyone else: no panel) and what the steps are. Finishing activates the
 * organization; if someone else already finished, it says so and goes.
 */
export function OnboardingPanel() {
  const { user, can } = useViewer();
  // Asked only of those who may read it; a 403 still just means no panel.
  const onboarding = useOrganizationsControllerGetOnboardingV1({
    query: { retry: false, enabled: can('organization.read') },
  });
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  }).data?.data;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const progressId = useId();
  const finishNoteId = useId();
  const data = onboarding.data?.data;

  if (!data || data.status !== 'PENDING_ONBOARDING') return null;

  const name = organization?.name ?? 'your organization';
  const done = data.steps.filter((step) => step.complete).length;
  const total = data.steps.length;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: getOrganizationsControllerGetOnboardingV1QueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: getOrganizationsControllerGetV1QueryKey(),
      }),
    ]);

  const finish = async () => {
    setBusy(true);
    try {
      await organizationsControllerCompleteOnboardingV1();
      toast.success('Setup complete', { description: `${name} is ready.` });
    } catch (failed) {
      if (!(failed instanceof ApiError && failed.status === 409)) {
        setBusy(false);
        toastError(
          'Couldn’t finish setup',
          'Check your connection and try again.',
        );
        return;
      }
      toast.info('Setup is already finished', {
        description: `${name} is ready to use.`,
      });
    }
    await refresh();
    // The panel that held focus is gone: the page's heading takes it.
    const heading = document.querySelector<HTMLElement>('#main h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  };

  return (
    <section aria-labelledby={titleId} className="p-4 pb-0 md:p-6 md:pb-0">
      <Card>
        {/* The steps come before Finish setup, as they're done; wider, the
            button sits beside the title. */}
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1 sm:col-start-1 sm:row-start-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-base font-semibold">
                Set up {name}
              </h2>
              <Badge variant="info">
                <InfoIcon aria-hidden />
                Setup in progress
              </Badge>
            </div>
            <p id={progressId} className="text-sm text-muted-foreground">
              {done} of {total} steps done
            </p>
          </div>
          <Progress
            value={total ? (done / total) * 100 : 0}
            aria-labelledby={progressId}
            className="sm:col-span-2"
          />
          <ol className="flex flex-col rounded-lg border sm:col-span-2">
            {data.steps.map((step) => (
              <Step
                key={step.key}
                step={step}
                emailVerified={user?.isEmailVerified ?? true}
              />
            ))}
          </ol>
          <Button
            className="sm:col-start-2 sm:row-start-1 sm:self-start"
            disabled={!data.canComplete || busy}
            aria-busy={busy || undefined}
            aria-describedby={data.canComplete ? undefined : finishNoteId}
            onClick={() => void finish()}
          >
            Finish setup
          </Button>
          {!data.canComplete && (
            <p
              id={finishNoteId}
              className="text-xs text-muted-foreground sm:col-span-2"
            >
              Finish every step to complete setup.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Step({
  step,
  emailVerified,
}: {
  step: OnboardingStepResponseDto;
  emailVerified: boolean;
}) {
  const noteId = useId();
  const action = ACTIONS[step.key];
  // Inviting needs a verified email; an area not built yet says that instead.
  const note =
    step.key === 'invite_team' && !emailVerified
      ? 'Verify your email first'
      : action && !action.href
        ? 'Not available yet'
        : null;

  return (
    <li
      aria-label={step.complete ? `${step.label}, done` : step.label}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2.5 text-sm last:border-b-0"
    >
      <span className="flex items-center gap-2">
        {step.complete ? (
          <CircleCheckIcon aria-hidden className="size-4 text-success" />
        ) : (
          <CircleIcon aria-hidden className="size-4 text-muted-foreground" />
        )}
        <span className={cn(step.complete && 'text-muted-foreground')}>
          {step.label}
        </span>
      </span>
      {step.complete ? (
        <span className="text-xs text-muted-foreground">Done</span>
      ) : (
        action && (
          <span className="flex flex-col items-end gap-1 max-sm:w-full max-sm:items-start max-sm:pl-6">
            {action.href && !note ? (
              <Link
                href={action.href}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                {action.label}
                <ArrowRightIcon />
              </Link>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled
                aria-describedby={noteId}
              >
                {action.label}
                <ArrowRightIcon />
              </Button>
            )}
            {note && (
              <span id={noteId} className="text-xs text-muted-foreground">
                {note}
              </span>
            )}
          </span>
        )
      )}
    </li>
  );
}
