'use client';

import {
  useDocumentsControllerListFlagsV1,
  useDocumentsControllerListV1,
  type DocumentsControllerListFlagsV1Params,
} from '@synapsedesk/api-client';
import { keepPreviousData } from '@tanstack/react-query';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useViewer } from '@/hooks/use-viewer';
import { FLAG_TYPE } from '@/lib/documents';
import { KnowledgeHeader } from '../knowledge/knowledge-header';
import { FlagCard } from './flag-card';
import { Empty, Pagination } from './parts';
import { PageUnavailable } from '@/components/shell/page-unavailable';

const PAGE = 10;
const ALL = 'all';
const SEVERITY_LABEL = {
  INFO: 'Info',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
};

type Filters = {
  type?: string;
  severity?: DocumentsControllerListFlagsV1Params['severity'];
  documentId?: string;
  includeResolved?: boolean;
};

/**
 * Knowledge › Quality flags: findings about how documents are used, newest
 * first, each fixed, replaced or dismissed in place.
 */
export function FlagsView() {
  const { can, query: viewer } = useViewer();
  const readable = can('document.read');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const params: DocumentsControllerListFlagsV1Params = {
    page,
    limit: PAGE,
    sortBy: 'detectedAt',
    sortOrder: 'DESC',
    type: filters.type ? [filters.type] : undefined,
    severity: filters.severity,
    documentId: filters.documentId,
    includeResolved: filters.includeResolved,
  };
  const list = useDocumentsControllerListFlagsV1(params, {
    query: { enabled: readable, placeholderData: keepPreviousData },
  });
  // The open count beside the resolved one, when both are shown.
  const open = useDocumentsControllerListFlagsV1(
    { ...params, includeResolved: undefined, page: 1, limit: 1 },
    { query: { enabled: readable && Boolean(filters.includeResolved) } },
  );
  const documents = useDocumentsControllerListV1(
    { limit: 100, sortBy: 'title', sortOrder: 'ASC' },
    { query: { enabled: readable, staleTime: 60_000 } },
  );

  const change = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  const pageData = list.data?.data;
  const total = pageData?.meta.totalItems ?? 0;
  const openCount = filters.includeResolved
    ? (open.data?.data?.meta.totalItems ?? null)
    : total;

  if (!viewer.isPending && !readable) {
    return (
      <>
        <AppHeader
          crumbs={[
            { label: 'Knowledge', href: '/knowledge' },
            { label: 'Not found' },
          ]}
        />
        <main id="main" tabIndex={-1} className="p-4 outline-none md:p-6">
          <PageUnavailable back={{ href: '/knowledge', label: 'Knowledge' }} />
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        crumbs={[
          { label: 'Knowledge', href: '/knowledge' },
          { label: 'Quality flags' },
        ]}
      />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-col gap-5 p-4 outline-none md:p-6"
      >
        <KnowledgeHeader
          tab="flags"
          description="Findings about how documents are used. Fix, replace or dismiss each."
        />

        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Type"
            value={filters.type}
            options={Object.fromEntries(
              Object.entries(FLAG_TYPE).map(([type, { label }]) => [
                type,
                label,
              ]),
            )}
            onValue={(type) => change({ ...filters, type })}
          />
          <FilterSelect
            label="Severity"
            value={filters.severity ?? undefined}
            options={SEVERITY_LABEL}
            onValue={(severity) =>
              change({ ...filters, severity: severity as Filters['severity'] })
            }
          />
          <FilterSelect
            label="Document"
            value={filters.documentId}
            options={Object.fromEntries(
              (documents.data?.data?.items ?? []).map((document) => [
                document.id,
                document.title,
              ]),
            )}
            onValue={(documentId) => change({ ...filters, documentId })}
          />
          <div className="ml-auto flex items-center gap-2">
            <Switch
              id="show-resolved"
              checked={Boolean(filters.includeResolved)}
              onCheckedChange={(checked) =>
                change({ ...filters, includeResolved: checked || undefined })
              }
            />
            <Label htmlFor="show-resolved" className="font-normal">
              Show resolved
            </Label>
          </div>
        </div>

        {list.isError && !pageData ? (
          <Empty
            icon={<CircleAlertIcon />}
            title="Couldn’t load the flags"
            description="Check your connection and try again."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : !pageData ? (
          <div aria-busy className="flex flex-col gap-3">
            <span className="sr-only" role="status">
              Loading flags
            </span>
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-32 max-w-290" />
            ))}
          </div>
        ) : pageData.items.length === 0 && !filters.includeResolved ? (
          <Empty
            icon={<CircleCheckIcon />}
            title="Nothing needs attention"
            description="Flags appear here when a document looks out of date, goes unused, gets poor ratings or disagrees with another."
          />
        ) : (
          <>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {filters.includeResolved
                ? openCount !== null
                  ? `${openCount} open · ${total - openCount} resolved`
                  : ''
                : `${total} open`}
            </p>
            <ul className="flex max-w-290 flex-col gap-3">
              {pageData.items.map((flag) => (
                <li key={flag.id}>
                  <FlagCard flag={flag} />
                </li>
              ))}
            </ul>
            {pageData.meta.totalPages > 1 && (
              <Pagination meta={pageData.meta} onPage={setPage} noun="flags" />
            )}
          </>
        )}
      </main>
    </>
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
  onValue: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onValue(next === ALL ? undefined : next)}
    >
      <SelectTrigger aria-label={label} className="w-45 gap-2">
        <span className="truncate">
          {value ? (
            <>
              <span className="text-muted-foreground">{label}: </span>
              {options[value]}
            </>
          ) : (
            <span className="text-muted-foreground">{label}</span>
          )}
        </span>
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
