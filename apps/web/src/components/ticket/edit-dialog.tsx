import {
  ticketsControllerUpdateV1,
  type ApiResponseTicketResponseDto,
  type TicketResponseDto,
  type UpdateTicketDtoPriority,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PRIORITY_LABEL } from '@/lib/tickets';
import { serverMessage } from './use-directory';

const TITLE_MIN = 3;
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 20_000;

type Priority = NonNullable<UpdateTicketDtoPriority>;

/** Edit a ticket's title, description and priority, in a dialog at every width. */
export function EditDialog({
  ticket,
  open,
  onOpenChange,
  onSaved,
}: {
  ticket: TicketResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (answer: ApiResponseTicketResponseDto) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="sm:max-w-130"
      >
        {open && (
          <EditForm
            ticket={ticket}
            onSaved={(answer) => {
              onSaved(answer);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  ticket,
  onSaved,
}: {
  ticket: TicketResponseDto;
  onSaved: (answer: ApiResponseTicketResponseDto) => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [priority, setPriority] = useState<Priority>(
    ticket.priority ?? 'MEDIUM',
  );
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
  }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = {
      title:
        title.trim().length < TITLE_MIN
          ? 'Enter a title of at least 3 characters.'
          : undefined,
      description:
        description.length > DESCRIPTION_MAX
          ? 'Shorten the description to 20,000 characters or fewer.'
          : !description.trim()
            ? 'Describe what you need.'
            : undefined,
    };
    setErrors(next);
    if (next.title || next.description) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await ticketsControllerUpdateV1(ticket.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      toast.success('Ticket updated');
      onSaved(answer);
    } catch (error) {
      setFailure(serverMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-busy={busy || undefined}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>{`Edit ticket #${ticket.ticketNumber}`}</DialogTitle>
      </DialogHeader>
      {failure && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>Couldn’t save your changes</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <Field
        id="edit-title"
        label="Title"
        error={errors.title}
        count={{ length: title.length, max: TITLE_MAX }}
      >
        {(aria) => (
          <Input
            id="edit-title"
            autoFocus
            maxLength={TITLE_MAX}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <Field
        id="edit-description"
        label="Description"
        error={errors.description}
        count={{ length: description.length, max: DESCRIPTION_MAX }}
      >
        {(aria) => (
          <Textarea
            id="edit-description"
            rows={5}
            className="max-h-72"
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
            {...aria}
          />
        )}
      </Field>
      <Field id="edit-priority" label="Priority">
        {(aria) => (
          <Select
            value={priority}
            onValueChange={(value) => setPriority(value as Priority)}
            disabled={busy}
          >
            <SelectTrigger id="edit-priority" className="w-full" {...aria}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
