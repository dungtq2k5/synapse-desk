'use client';

import {
  useDepartmentsControllerListV1,
  useUserAdminControllerListV1,
  type TicketsControllerListV1Params,
} from '@synapsedesk/api-client';
import { CheckIcon, SearchIcon, UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
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
>;

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

  // The search is sent once typing pauses.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const searchTerm = search.trim() || undefined;
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
      <div className="relative w-full md:w-72">
        <SearchIcon
          aria-hidden
          className="absolute top-2.5 left-3 size-4 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

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
