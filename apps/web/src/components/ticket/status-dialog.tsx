import {
  ticketsControllerChangeStatusV1,
  ticketsControllerCloseV1,
  ticketsControllerEscalateV1,
  ticketsControllerReopenV1,
  ticketsControllerResolveV1,
  type ApiResponseTicketResponseDto,
  type TicketResponseDto,
} from '@synapsedesk/api-client';
import { CircleAlertIcon } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABEL, type StatusMove } from '@/lib/tickets';

const REASON_MAX = 500;

/** Each route's call; every one answers with the ticket. */
const CALL: Record<
  StatusMove['route'],
  (
    id: string,
    to: StatusMove['to'],
    reason: string | null,
  ) => Promise<ApiResponseTicketResponseDto>
> = {
  resolve: (id, _to, reason) => ticketsControllerResolveV1(id, { reason }),
  close: (id, _to, reason) => ticketsControllerCloseV1(id, { reason }),
  reopen: (id, _to, reason) => ticketsControllerReopenV1(id, { reason }),
  escalate: (id, _to, reason) => ticketsControllerEscalateV1(id, { reason }),
  status: (id, to, reason) =>
    ticketsControllerChangeStatusV1(id, {
      status: to,
      reason,
    }),
};

/**
 * One dialog for every status move: its own title, words and button, and an
 * optional reason for the history. A failure keeps the reason for another try.
 */
export function StatusDialog({
  ticket,
  move,
  onOpenChange,
  onMoved,
}: {
  ticket: TicketResponseDto;
  /** The move being confirmed; `null` while closed. */
  move: StatusMove | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (answer: ApiResponseTicketResponseDto) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = (open: boolean) => {
    if (busy) return;
    if (!open) {
      setReason('');
      setFailed(false);
    }
    onOpenChange(open);
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!move || reason.length > REASON_MAX) return;
    setBusy(true);
    setFailed(false);
    try {
      const answer = await CALL[move.route](
        ticket.id,
        move.to,
        reason.trim() || null,
      );
      onMoved(answer);
      toast.success(`Status changed to ${STATUS_LABEL[move.to]}`);
      setBusy(false);
      close(false);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <Dialog open={move !== null} onOpenChange={close}>
      <DialogContent showCloseButton={false} aria-busy={busy || undefined}>
        {move && (
          <form
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{move.title(ticket.ticketNumber)}</DialogTitle>
              <DialogDescription>{move.description}</DialogDescription>
            </DialogHeader>
            {failed && (
              <Alert variant="destructive">
                <CircleAlertIcon aria-hidden />
                <AlertTitle>Couldn’t change the status</AlertTitle>
                <AlertDescription>
                  Something went wrong on our side. Your reason is still here;
                  try again.
                </AlertDescription>
              </Alert>
            )}
            <Field
              id="status-reason"
              label="Reason (optional)"
              description="Shown in the ticket’s history."
              count={{ length: reason.length, max: REASON_MAX }}
            >
              {(aria) => (
                <Textarea
                  id="status-reason"
                  autoFocus
                  rows={3}
                  placeholder="Why are you making this change?"
                  value={reason}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                  {...aria}
                  aria-invalid={reason.length > REASON_MAX || undefined}
                />
              )}
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={busy || reason.length > REASON_MAX}
              >
                {busy ? move.busy : move.confirm}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
