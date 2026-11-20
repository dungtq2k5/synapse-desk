'use client';

import type { ReactNode } from 'react';
import { AppHeader } from '@/components/shell/app-header';
import { cn } from '@/lib/utils';

/**
 * A console page: the bar with its crumbs (after "Platform"), then the page's
 * heading and its body. Actions sit on the right at desktop and under the
 * heading, on the left, at 390.
 *
 * @example <ConsolePage crumbs={[{ label: 'Plans' }]} title="Plans" description="…">…</ConsolePage>
 */
export function ConsolePage({
  crumbs,
  title,
  badge,
  description,
  actions,
  children,
  className,
}: {
  crumbs: { label: string; href?: string }[];
  title: string;
  /** Beside the title: an organization's status. */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <AppHeader crumbs={crumbs} />
      <main
        id="main"
        tabIndex={-1}
        className={cn('flex flex-col gap-6 p-4 outline-none md:p-6', className)}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight break-words">
                {title}
              </h1>
              {badge}
            </div>
            {description && (
              <div className="text-sm text-muted-foreground">{description}</div>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
              {actions}
            </div>
          )}
        </div>
        {children}
      </main>
    </>
  );
}

/** A console card: a title, a line under it, then its body. */
export function ConsoleCard({
  title,
  lead,
  action,
  children,
  className,
}: {
  title: string;
  lead?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-semibold">{title}</h2>
          {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label and value pairs, as an organization's Profile card lists them. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
