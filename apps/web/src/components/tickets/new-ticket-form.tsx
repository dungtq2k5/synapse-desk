'use client';

import {
  ApiError,
  ticketsControllerCreateV1,
  useUserAdminControllerListV1,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDownIcon, CircleAlertIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Popover } from 'radix-ui';
import { useEffect, useId, useState, type SubmitEvent } from 'react';
import { Field } from '@/components/auth/field';
import { UserAvatar } from '@/components/shell/user-avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useViewer } from '@/hooks/use-viewer';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';

const TITLE_MIN = 3;
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 20_000;

type Person = { id: string; fullName: string; email: string };
type Failure = { kind: 'failed' } | { kind: 'busy'; minutes: number };

/**
 * A new ticket: title and description, and for an agent who can list people,
 * who it's for (themselves by default). `authorId` is sent only when it's
 * someone else; the server refuses it from anyone but an agent.
 */
export function NewTicketForm() {
  const { user, isAgent, can } = useViewer();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requester, setRequester] = useState<Person | null>(null);
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
  }>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const chooses = isAgent && can('user.read');

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = {
      title:
        title.trim().length < TITLE_MIN
          ? 'Enter a title of at least 3 characters.'
          : undefined,
      description: !description.trim() ? 'Describe what you need.' : undefined,
    };
    setErrors(next);
    if (next.title || next.description) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await ticketsControllerCreateV1({
        title: title.trim(),
        description: description.trim(),
        authorId:
          requester && requester.id !== user?.id ? requester.id : undefined,
      });
      if (!answer.data) throw new Error('No ticket');
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] });
      announce(`Ticket #${answer.data.ticketNumber} created`);
      router.push(`/tickets/${answer.data.id}`);
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.status === 429
          ? {
              kind: 'busy',
              minutes: Math.max(
                1,
                Math.ceil((error.retryAfterSeconds ?? 60) / 60),
              ),
            }
          : { kind: 'failed' },
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New ticket</h1>
        <p className="text-sm text-muted-foreground">
          {isAgent
            ? 'Raise a ticket for yourself or for someone else.'
            : 'Tell us what you need. We’ll reply in the ticket.'}
        </p>
      </div>
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-busy={busy || undefined}
        className="flex w-full max-w-160 flex-col gap-4 rounded-lg border bg-card p-4 md:p-6"
      >
        {failure && (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden />
            {failure.kind === 'busy' ? (
              <>
                <AlertTitle>Too many new tickets</AlertTitle>
                <AlertDescription>
                  {`You’ve created several tickets in a short time. Try again in ${failure.minutes} ${failure.minutes === 1 ? 'minute' : 'minutes'}.`}
                </AlertDescription>
              </>
            ) : (
              <>
                <AlertTitle>Couldn’t create your ticket</AlertTitle>
                <AlertDescription>
                  Something went wrong on our side. Your text and files are
                  still here; try again.
                </AlertDescription>
              </>
            )}
          </Alert>
        )}
        {chooses && user && (
          <RequesterField
            me={{ id: user.id, fullName: user.fullName, email: user.email }}
            value={requester}
            onValue={setRequester}
          />
        )}
        <Field
          id="new-title"
          label="Title"
          error={errors.title}
          count={{ length: title.length, max: TITLE_MAX }}
        >
          {(aria) => (
            <Input
              id="new-title"
              autoFocus={!chooses}
              maxLength={TITLE_MAX}
              placeholder="Summarize it in a few words"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <Field
          id="new-description"
          label="Description"
          error={errors.description}
          count={{ length: description.length, max: DESCRIPTION_MAX }}
        >
          {(aria) => (
            <Textarea
              id="new-description"
              rows={6}
              maxLength={DESCRIPTION_MAX}
              placeholder="What happened, and what do you need?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              {...aria}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Link
            href="/tickets"
            className={buttonVariants({ variant: 'outline' })}
          >
            Cancel
          </Link>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create ticket'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Who the ticket is for: a button naming them, which opens a search of the
 * organization's people by name or email.
 */
function RequesterField({
  me,
  value,
  onValue,
}: {
  me: Person;
  value: Person | null;
  onValue: (person: Person) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const chosen = value ?? me;

  // Searched once typing pauses.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setTerm(query.trim()), 250);
    return () => globalThis.clearTimeout(timer);
  }, [query]);

  const people = useUserAdminControllerListV1(
    {
      page: 1,
      limit: 20,
      sortBy: 'fullName',
      sortOrder: 'ASC',
      searchTerm: term || undefined,
    },
    { query: { enabled: open } },
  );
  const items: Person[] = (people.data?.data?.items ?? []).map(({ user }) => ({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
  }));
  const optionId = (index: number) => `${listId}-${index}`;

  const pick = (person: Person) => {
    onValue(person);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={`${listId}-label`} className="text-sm font-medium">
        Requester
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-labelledby={`${listId}-label ${listId}-value`}
            aria-describedby={`${listId}-help`}
            className="w-full justify-between font-normal"
          >
            <span id={`${listId}-value`} className="flex items-center gap-2">
              <UserAvatar name={chosen.fullName} />
              {chosen.id === me.id ? `${me.fullName} (you)` : chosen.fullName}
            </span>
            <ChevronsUpDownIcon aria-hidden className="text-muted-foreground" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label="Requester"
            align="start"
            sideOffset={4}
            className="z-50 w-(--radix-popover-trigger-width) rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
              />
              <Input
                role="combobox"
                aria-label="Search people by name or email"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={
                  items[active] ? optionId(active) : undefined
                }
                autoFocus
                placeholder="Search people by name or email"
                className="border-0 pl-8 shadow-none focus-visible:ring-0"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActive((index) => Math.min(index + 1, items.length - 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActive((index) => Math.max(index - 1, 0));
                  } else if (event.key === 'Enter' && items[active]) {
                    event.preventDefault();
                    pick(items[active]);
                  }
                }}
              />
            </div>
            <ul
              id={listId}
              role="listbox"
              aria-label="People"
              className="max-h-64 overflow-y-auto border-t pt-1"
            >
              {items.map((person, index) => (
                <li
                  key={person.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                    index === active && 'bg-accent text-accent-foreground',
                  )}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(person)}
                >
                  <UserAvatar name={person.fullName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {person.fullName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {person.email}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p
              aria-live="polite"
              className="px-2 text-sm text-muted-foreground"
            >
              {term && people.isSuccess && items.length === 0
                ? `No one matches “${term}”.`
                : ''}
            </p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <p id={`${listId}-help`} className="text-sm text-muted-foreground">
        Who it’s for. They see the ticket and get the replies.
      </p>
    </div>
  );
}
