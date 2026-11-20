'use client';

import {
  useAnalyticsControllerDocumentsV1,
  useAnalyticsControllerKnowledgeGapsV1,
  type DocumentUsageResponseDto,
  type KnowledgeGapsResponseDto,
  type RateResponseDto,
} from '@synapsedesk/api-client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { LoadError } from '@/components/settings/settings-frame';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { count, percent } from '@/lib/analytics';
import { FLAG_TYPE } from '@/lib/documents';
import { AnalyticsFrame, DataThrough, useAnalyticsFilters } from './frame';
import { StatTiles, type Tile, Unavailable } from './tiles';

/** A rate tile in the gaps card, or its reason when nothing was measured. */
function rateTile(label: string, rate: RateResponseDto, help: string): Tile {
  return rate.rate == null
    ? { label, value: null, counts: 'No answers yet', help }
    : {
        label,
        value: percent(rate.rate),
        counts: `${count(rate.numerator)} of ${count(rate.denominator)} answers`,
        help,
      };
}

/**
 * Analytics › Knowledge: where answers found nothing, the open flags that say
 * which documents, and how documents are used (all time).
 */
export function KnowledgeView() {
  const filters = useAnalyticsFilters();
  const { from, to, by } = filters.filters;
  const gaps = useAnalyticsControllerKnowledgeGapsV1(
    { from, to, granularity: by },
    { query: { enabled: filters.ready } },
  );
  const documents = useAnalyticsControllerDocumentsV1(
    {},
    { query: { enabled: filters.ready } },
  );
  const gapData = gaps.data?.data;
  const documentData = documents.data?.data;

  let body;
  if (gaps.isError && documents.isError) {
    body = (
      <LoadError
        what="analytics"
        onRetry={() => {
          void gaps.refetch();
          void documents.refetch();
        }}
      />
    );
  } else if (!gapData || !documentData) {
    body = (
      <div aria-busy>
        <span className="sr-only" role="status">
          Loading analytics
        </span>
        <Skeleton aria-hidden className="h-80 w-full rounded-xl" />
      </div>
    );
  } else {
    const gapsDown = gapData.unavailable.length > 0;
    const listsDown = documentData.unavailable.some(
      (block) => block.source === 'ingestion-service',
    );
    const accuracyDown = documentData.unavailable.some(
      (block) => block.source === 'ticket-service',
    );
    const retryGaps = () => void gaps.refetch();
    const retryDocuments = () => void documents.refetch();
    body = (
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {gapsDown ? (
            <Unavailable
              title="Gaps"
              what="The gaps couldn’t be read"
              onRetry={retryGaps}
            />
          ) : (
            <Card
              title="Gaps"
              lead="In the period. Gaps are questions the documents can’t answer yet."
            >
              <StatTiles
                className="lg:grid-cols-2"
                tiles={[
                  rateTile(
                    'Answers that found no documents',
                    gapData.emptyRetrievalRate,
                    'Answers where search found nothing to cite, so the AI said it couldn’t help or answered without sources.',
                  ),
                  rateTile(
                    'Answers grounded by an attachment',
                    gapData.attachmentGroundedRate,
                    'Answers that used a file attached to the conversation rather than the knowledge base.',
                  ),
                ]}
              />
            </Card>
          )}
          {gapsDown ? (
            <Unavailable
              title="Open quality flags"
              what="The open flags couldn’t be read"
              onRetry={retryGaps}
            />
          ) : (
            <Flags flags={gapData.flags} />
          )}
        </div>
        <section
          aria-labelledby="documents-title"
          className="flex flex-col gap-4"
        >
          <div className="space-y-1">
            <h2 id="documents-title" className="text-lg font-semibold">
              Documents
            </h2>
            <p className="text-sm text-muted-foreground">
              All time: these lists count every answer since each document was
              added. They don’t follow the date range or department.
            </p>
          </div>
          {accuracyDown ? (
            <Unavailable
              title="Citation accuracy"
              what="Citation accuracy couldn’t be read"
              onRetry={retryDocuments}
            />
          ) : (
            <StatTiles
              className="lg:grid-cols-2"
              tiles={[
                documentData.citationAccuracy?.rate == null
                  ? {
                      label: 'Citation accuracy',
                      value: null,
                      counts: 'No rated citations yet',
                      help: 'How often people who rated an answer said its citations were accurate.',
                    }
                  : {
                      label: 'Citation accuracy',
                      value: percent(documentData.citationAccuracy.rate),
                      counts: `All time · ${count(documentData.citationAccuracy.numerator)} of ${count(documentData.citationAccuracy.denominator)} rated citations`,
                      help: 'How often people who rated an answer said its citations were accurate.',
                    },
              ]}
            />
          )}
          {listsDown ? (
            <Unavailable
              title="Documents"
              what="The document lists couldn’t be read"
              onRetry={retryDocuments}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <DocumentList
                title="Most cited"
                lead="All time. The documents answers lean on most."
                empty="Nothing cited yet."
                rows={documentData.mostCited}
                columns={[
                  ['Citations', (row) => row.citationCount],
                  ['Retrievals', (row) => row.retrievalCount],
                ]}
              />
              <DocumentList
                title="Never retrieved"
                lead="All time. Never found for any question. If one is out of date or a duplicate, consider removing it."
                empty="Every document has been found at least once."
                rows={documentData.neverRetrieved}
                columns={[['Passages', (row) => row.chunkCount]]}
              />
              <DocumentList
                title="Retrieved, never cited"
                lead="All time. Found for questions but never used in an answer. It may crowd out documents that would answer; check it’s accurate and specific."
                empty="Every retrieved document has been cited."
                rows={documentData.retrievedNeverCited}
                columns={[
                  ['Retrievals', (row) => row.retrievalCount],
                  ['Passages', (row) => row.chunkCount],
                ]}
              />
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <AnalyticsFrame
      section="knowledge"
      filters={filters}
      departments={false}
      status={gapData && <DataThrough dataThrough={gapData.dataThrough} />}
    >
      {body}
    </AnalyticsFrame>
  );
}

function Card({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * The open flags the server sends here: documents nobody's question finds,
 * and ones found but never cited. Every type is on 07's flags page.
 */
function Flags({ flags }: { flags: KnowledgeGapsResponseDto['flags'] }) {
  return (
    <Card
      title="Open quality flags"
      lead={
        flags.length === 0
          ? 'Flags appear when documents look outdated, conflict, or go unused.'
          : `${count(flags.length)} open. Each links to the document’s page; resolve them there.`
      }
    >
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open flags</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={`${flag.documentId}:${flag.flagType}`}>
                  <TableCell>
                    <Badge variant="info" className="rounded-full">
                      {flag.flagType ? FLAG_TYPE[flag.flagType].label : 'Flag'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/knowledge/documents/${flag.documentId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {flag.documentTitle}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {flag.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Link
        href="/knowledge/flags"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        All quality flags
      </Link>
    </Card>
  );
}

function DocumentList({
  title,
  lead,
  empty,
  rows,
  columns,
}: {
  title: string;
  lead: string;
  empty: string;
  rows: DocumentUsageResponseDto[];
  columns: [string, (row: DocumentUsageResponseDto) => number][];
}) {
  return (
    <Card title={title} lead={lead}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Document</TableHead>
                {columns.map(([label]) => (
                  <TableHead key={label} className="text-right">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.documentId}>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/knowledge/documents/${row.documentId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  {columns.map(([label, value]) => (
                    <TableCell key={label} className="text-right tabular-nums">
                      {count(value(row))}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
