'use client';

import { useDepartmentsControllerListV1 } from '@synapsedesk/api-client';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useViewer } from '@/hooks/use-viewer';
import { cn } from '@/lib/utils';

/** Department names by id, for the people who may read them. */
export function useDepartmentNames(): ReadonlyMap<string, string> {
  const { can } = useViewer();
  const departments = useDepartmentsControllerListV1(
    { limit: 100, sortBy: 'name', sortOrder: 'ASC' },
    { query: { enabled: can('department.read'), staleTime: 60_000 } },
  );
  return useMemo(
    () =>
      new Map(
        (departments.data?.data?.items ?? []).map((department) => [
          department.id,
          department.name,
        ]),
      ),
    [departments.data],
  );
}

/** "See plans and billing" for someone who can change the plan; a pointer otherwise. */
export function PlanLink({ canChange }: { canChange: boolean }) {
  return canChange ? (
    <Link
      href="/settings/billing"
      className={cn(buttonVariants({ variant: 'link' }), 'h-auto p-0')}
    >
      See plans and billing
    </Link>
  ) : (
    <span>Ask an administrator to change the plan.</span>
  );
}

/** "Showing {from}–{to} of {total}", with Previous and Next. */
export function Pagination({
  meta,
  onPage,
  noun,
}: {
  meta: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    itemCount: number;
  };
  onPage: (page: number) => void;
  noun: string;
}) {
  const from = (meta.currentPage - 1) * meta.itemsPerPage + 1;
  const to = from + meta.itemCount - 1;
  return (
    <nav
      aria-label={`Pages of ${noun}`}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted-foreground">
        Showing {from}–{to} of {meta.totalItems}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.currentPage <= 1}
          onClick={() => onPage(meta.currentPage - 1)}
        >
          <ChevronLeftIcon aria-hidden />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.currentPage >= Math.max(1, meta.totalPages)}
          onClick={() => onPage(meta.currentPage + 1)}
        >
          Next
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
