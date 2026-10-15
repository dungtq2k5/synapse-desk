'use client';

import {
  useDepartmentsControllerListV1,
  useTicketsControllerGetByNumberV1,
  useUserAdminControllerListV1,
  type TicketsControllerListV1Params,
} from '@synapsedesk/api-client';
import {
  ArrowRightIcon,
  CheckIcon,
  SearchIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useViewer } from '@/hooks/use-viewer';
import { PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL } from '@/lib/tickets';

/** The filters the toolbar sets; one value each, as the API takes them. */
export type Filters = Pick<
  TicketsControllerListV1Params,
  | 'searchTerm'
  | 'status'
  | 'priority'
  | 'source'
  | 'assigneeId'
  | 'departmentId'
  | 'includeDeleted'
>;

/** "#1042" or "1042": a ticket number to go to. */
const NUMBER = /^#?(\d{1,9})$/;

const ALL = 'all';

/**
 * The list's toolbar: search, "Assigned to me" and the filters. An end user
 * gets search and Status only. Assignee and Department need their option
 * lists, so they appear only for an agent who may read users and departments.
 */
export function TicketFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const { user, isAgent, can } = useViewer();
  const [search, setSearch] = useState(filters.searchTerm ?? '');
  const number = NUMBER.exec(search.trim())?.[1];

  // The search is sent once typing pauses.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      // A ticket number is found by number, not searched for as text.
      const searchTerm = NUMBER.test(search.trim())
        ? undefined
        : search.trim() || undefined;
      if (searchTerm !== filters.searchTerm)
        onChange({ ...filters, searchTerm });
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [search, filters, onChange]);

  const set = <K extends keyof Filters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value === ALL ? undefined : value });
  const mine = Boolean(user && filters.assigneeId === user.id);
  const active = Object.values(filters).some((value) => value !== undefined);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FindByNumber
        search={search}
        number={number ? Number(number) : null}
        onSearch={setSearch}
      />

      {isAgent && user && (
        <Toggle
          variant="outline"
          size="sm"
          pressed={mine}
          onPressedChange={(pressed) =>
            onChange({ ...filters, assigneeId: pressed ? user.id : undefined })
          }
          className="data-[state=on]:border-primary"
        >
          {mine ? <CheckIcon /> : <UserIcon />}
          Assigned to me
        </Toggle>
      )}

      {isAgent && can('ticket.delete') && (
        <Toggle
          variant="outline"
          size="sm"
          pressed={Boolean(filters.includeDeleted)}
          onPressedChange={(pressed) =>
            onChange({ ...filters, includeDeleted: pressed || undefined })
          }
          className="data-[state=on]:border-primary"
        >
          {filters.includeDeleted ? <CheckIcon /> : <Trash2Icon />}
          Show deleted
        </Toggle>
      )}

      <FilterSelect
        label="Status"
        value={filters.status}
        options={STATUS_LABEL}
        onValue={(value) => set('status', value)}
      />
      {isAgent && (
        <>
          <FilterSelect
            label="Priority"
            value={filters.priority}
            options={PRIORITY_LABEL}
            onValue={(value) => set('priority', value)}
          />
          <FilterSelect
            label="Source"
            value={filters.source}
            options={SOURCE_LABEL}
            onValue={(value) => set('source', value)}
          />
          {can('user.read') && (
            <AssigneeFilter
              value={mine ? undefined : filters.assigneeId}
              onValue={(value) => set('assigneeId', value)}
            />
          )}
          {can('department.read') && (
            <DepartmentFilter
              value={filters.departmentId}
              onValue={(value) => set('departmentId', value)}
            />
          )}
        </>
      )}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            onChange({});
          }}
        >
          Reset
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onValue,
}: {
  label: string;
  value: string | undefined;
  options: Record<string, string>;
  onValue: (value: string) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={onValue}>
      <SelectTrigger size="sm" aria-label={label} className="w-auto gap-2">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="shadow-md">
        <SelectItem value={ALL}>All</SelectItem>
        {Object.entries(options).map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssigneeFilter({
  value,
  onValue,
}: {
  value: string | undefined;
  onValue: (value: string) => void;
}) {
  // ponytail: the first 100 users; a searchable picker when organizations outgrow it.
  const users = useUserAdminControllerListV1({
    limit: 100,
    sortBy: 'fullName',
    sortOrder: 'ASC',
  });
  const options = Object.fromEntries(
    (users.data?.data?.items ?? []).map(({ user }) => [user.id, user.fullName]),
  );
  return (
    <FilterSelect
      label="Assignee"
      value={value}
      options={options}
      onValue={onValue}
    />
  );
}

function DepartmentFilter({
  value,
  onValue,
}: {
  value: string | undefined;
  onValue: (value: string) => void;
}) {
  // ponytail: the first 100 departments, as for assignees.
  const departments = useDepartmentsControllerListV1({
    limit: 100,
    sortBy: 'name',
    sortOrder: 'ASC',
  });
  const options = Object.fromEntries(
    (departments.data?.data?.items ?? []).map((department) => [
      department.id,
      department.name,
    ]),
  );
  return (
    <FilterSelect
      label="Department"
      value={value}
      options={options}
      onValue={onValue}
    />
  );
}

/**
 * The search box, which also finds a ticket by its number: "#1042" or "1042"
 * offers "Go to #1042" with its title, or says there's no such ticket. The
 * box is a combobox; Enter goes to the ticket found.
 */
function FindByNumber({
  search,
  number,
  onSearch,
}: {
  search: string;
  number: number | null;
  onSearch: (value: string) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const optionId = useId();
  const [open, setOpen] = useState(true);
  const found = useTicketsControllerGetByNumberV1(number ?? 0, {
    query: { enabled: number !== null, retry: false, staleTime: 30_000 },
  });
  const ticket = number !== null ? found.data?.data : undefined;
  const missing = number !== null && found.isError;
  const showing = open && number !== null && (Boolean(ticket) || missing);

  return (
    <div className="relative w-full md:w-72">
      <SearchIcon
        aria-hidden
        className="absolute top-2.5 left-3 size-4 text-muted-foreground"
      />
      <Input
        type="search"
        role="combobox"
        aria-label="Search tickets"
        aria-expanded={showing && Boolean(ticket)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && ticket ? optionId : undefined}
        placeholder="Search tickets"
        className="pl-9"
        value={search}
        onChange={(event) => {
          setOpen(true);
          onSearch(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && ticket) {
            event.preventDefault();
            router.push(`/tickets/${ticket.id}`);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Go to a ticket"
        hidden={!(showing && ticket)}
        className="absolute top-full left-0 z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md"
      >
        {ticket && (
          <li
            id={optionId}
            role="option"
            aria-selected
            className="flex cursor-pointer items-center gap-2 rounded-sm bg-accent px-2 py-1.5 text-sm text-accent-foreground"
            // Before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault();
              router.push(`/tickets/${ticket.id}`);
            }}
          >
            <ArrowRightIcon aria-hidden className="size-4 shrink-0" />
            <span className="shrink-0 font-medium">{`Go to #${ticket.ticketNumber}`}</span>
            <span className="truncate text-muted-foreground">
              {ticket.title}
            </span>
          </li>
        )}
      </ul>
      <p
        aria-live="polite"
        className={
          showing && missing
            ? 'absolute top-full left-0 z-20 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md'
            : 'sr-only'
        }
      >
        {showing && missing ? `No ticket #${number}` : ''}
      </p>
    </div>
  );
}
