'use client';

import { useUserAdminControllerListV1 } from '@synapsedesk/api-client';
import { XIcon } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type Picked = { id: string; fullName: string };

/**
 * Several people, found by typing: chips, each with its own remove button, and
 * a list of matches under the field. Arrow keys move through the matches and
 * Enter picks one. At `max` chosen the field stops offering more.
 * `includeDeleted` also finds people who have left (an audit log's actors).
 *
 * @example <PeoplePicker id="holders" value={picked} onChange={setPicked} exclude={held} />
 */
export function PeoplePicker({
  id,
  value,
  onChange,
  exclude = [],
  max = 50,
  label = 'People',
  includeDeleted = false,
}: {
  id: string;
  value: Picked[];
  onChange: (value: Picked[]) => void;
  /** Ids not to offer: people already in. */
  exclude?: readonly string[];
  max?: number;
  label?: string;
  includeDeleted?: boolean;
}) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setSearch(text.trim()), 200);
    return () => globalThis.clearTimeout(timer);
  }, [text]);

  const found = useUserAdminControllerListV1(
    {
      searchTerm: search || undefined,
      ...(includeDeleted ? { includeDeleted: true } : {}),
      limit: 8,
      sortBy: 'fullName',
      sortOrder: 'ASC',
    },
    { query: { enabled: open } },
  );
  const matches = (found.data?.data?.items ?? [])
    .map((item) => item.user)
    .filter(
      (user) =>
        !exclude.includes(user.id) &&
        !value.some((picked) => picked.id === user.id),
    );
  const full = value.length >= max;

  const pick = (user: Picked) => {
    onChange([...value, { id: user.id, fullName: user.fullName }]);
    setText('');
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        Math.min(index + 1, Math.max(0, matches.length - 1)),
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && open && matches[active]) {
      event.preventDefault();
      pick(matches[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {max > 1 && (
          <span className="text-xs text-muted-foreground">Up to {max}</span>
        )}
      </div>
      <div className="relative">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          {value.map((picked) => (
            <span
              key={picked.id}
              className="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
            >
              {picked.fullName}
              <button
                type="button"
                aria-label={`Remove ${picked.fullName}`}
                className="rounded-sm p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  onChange(value.filter((each) => each.id !== picked.id))
                }
              >
                <XIcon aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          <input
            id={id}
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && matches[active]
                ? `${listId}-${matches[active].id}`
                : undefined
            }
            disabled={full}
            value={text}
            placeholder="Search people"
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => globalThis.setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            className="min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {open && matches.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {matches.map((user, index) => (
              <li
                key={user.id}
                id={`${listId}-${user.id}`}
                role="option"
                aria-selected={index === active}
                className={cn(
                  'flex cursor-default flex-col rounded-sm px-2 py-1.5 text-sm',
                  index === active && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(user)}
              >
                <span>{user.fullName}</span>
                <span className="text-xs text-muted-foreground">
                  {user.email}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
