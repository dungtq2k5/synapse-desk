'use client';

import {
  usePlatformControllerListPlansV1,
  type SubscriptionPlanResponseDto,
} from '@synapsedesk/api-client';
import { PackageIcon, PlusIcon, SearchXIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Empty, Pagination } from '@/components/documents/parts';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { aiMoney, money } from '@/lib/billing';
import { fileSize } from '@/lib/format';
import { PlanBadges } from './badges';
import { ConsolePage } from './console-page';
import { SearchBox, SwitchFilter, Toolbar } from './toolbar';

const PAGE_SIZE = 20;

/** A price in the catalog's words: "$99.00 a month". */
export function priceLine(
  price: SubscriptionPlanResponseDto['prices'][number],
) {
  const amount =
    price.unitAmount === null ||
    price.unitAmount === undefined ||
    !price.currency
      ? null
      : money(price.unitAmount, price.currency, 'en-US');
  const per = price.interval === 'year' ? 'a year' : 'a month';
  return amount ? `${amount} ${per}` : `${price.stripePriceId} ${per}`;
}

const tier = (value: string | null | undefined) =>
  value === 'QUALITY' ? 'Quality' : 'Fast';

/**
 * The catalog: each plan's grants side by side, its prices and subscribers.
 * "Show retired and not offered" adds the rest, each with its badge.
 */
export function PlansView() {
  const [searchTerm, setSearchTerm] = useState<string | undefined>();
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const [cleared, setCleared] = useState(0);
  const list = usePlatformControllerListPlansV1({
    page,
    limit: PAGE_SIZE,
    sortBy: 'createdAt',
    sortOrder: 'ASC',
    searchTerm,
    includeInactive: all || undefined,
    includeDeleted: all || undefined,
  });
  const search = useCallback((value: string | undefined) => {
    setSearchTerm(value);
    setPage(1);
  }, []);
  const data = list.data?.data;

  return (
    <ConsolePage
      crumbs={[{ label: 'Plans' }]}
      title="Plans"
      description="The catalog organizations subscribe to. Editing a plan changes the catalog; its subscribers change only when you apply it."
      actions={
        <Link
          href="/platform/plans/new"
          className={buttonVariants({ variant: 'default' })}
        >
          <PlusIcon aria-hidden />
          New plan
        </Link>
      }
    >
      <Toolbar key={cleared}>
        <SearchBox label="Search plans" value={searchTerm} onSearch={search} />
        <SwitchFilter
          label="Show retired and not offered"
          checked={all}
          onChange={(checked) => {
            setAll(checked);
            setPage(1);
          }}
        />
      </Toolbar>
      {list.isError && !data ? (
        <LoadError what="plans" onRetry={() => void list.refetch()} />
      ) : !data ? (
        <Loading what="plans" className="h-96" />
      ) : data.items.length === 0 && searchTerm ? (
        <Empty
          icon={<SearchXIcon />}
          title="No plans match"
          description="Try another name."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                search(undefined);
                setCleared((n) => n + 1);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <Empty icon={<PackageIcon />} title="No plans yet" description="" />
      ) : (
        <>
          <div
            aria-busy={list.isFetching || undefined}
            className="hidden overflow-x-auto rounded-lg border md:block"
          >
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Prices</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead className="text-right">Storage</TableHead>
                  <TableHead>AI a month</TableHead>
                  <TableHead>Largest file</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                  <TableHead>Analytics</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <PlanName plan={plan} />
                    </TableCell>
                    <TableCell>
                      <Prices plan={plan} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.maxAgentSeats.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fileSize(plan.maxStorageBytes)}
                    </TableCell>
                    <TableCell>
                      {`${aiMoney(plan.monthlyAiTokenBudget, 'en-US')} · ${tier(plan.aiModelTier)}`}
                    </TableCell>
                    <TableCell>
                      {`${fileSize(plan.maxDocumentBytes)} · ${fileSize(plan.maxAttachmentBytes)}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.maxDocumentUploads.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell>{`${plan.maxAnalyticsRangeDays} days`}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {plan.subscriberCount.toLocaleString('en-US')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.items.map((plan) => (
              <li
                key={plan.id}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm"
              >
                <PlanName plan={plan} />
                <Prices plan={plan} />
                <p className="text-muted-foreground">
                  {`${plan.maxAgentSeats.toLocaleString('en-US')} seats · ${fileSize(plan.maxStorageBytes)} · ${aiMoney(plan.monthlyAiTokenBudget, 'en-US')} · ${tier(plan.aiModelTier)}`}
                </p>
                <p className="text-muted-foreground">
                  {`${plan.subscriberCount.toLocaleString('en-US')} subscribers`}
                </p>
              </li>
            ))}
          </ul>
          {data.meta.totalPages > 1 && (
            <Pagination
              meta={data.meta}
              onPage={setPage}
              noun="plans"
              stacked
            />
          )}
        </>
      )}
    </ConsolePage>
  );
}

function PlanName({ plan }: { plan: SubscriptionPlanResponseDto }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Link
        href={`/platform/plans/${plan.id}`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {plan.name}
      </Link>
      {plan.deletedAt ? (
        <span className="text-xs text-muted-foreground">Retired</span>
      ) : (
        <PlanBadges
          stripeProductId={plan.stripeProductId}
          isActive={plan.isActive}
        />
      )}
    </div>
  );
}

function Prices({ plan }: { plan: SubscriptionPlanResponseDto }) {
  if (plan.prices.length === 0) return <span>—</span>;
  return (
    <span className="flex flex-col">
      {plan.prices.map((price) => (
        <span key={price.id}>{priceLine(price)}</span>
      ))}
    </span>
  );
}
