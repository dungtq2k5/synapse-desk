import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * A sign-in screen's panel: a card on wider screens, the page itself on
 * phones. Holds the screen's h1, its lead, and the form.
 */
export function AuthCard({
  title,
  lead,
  above,
  icon,
  children,
  busy,
  titleRef,
}: {
  title: string;
  lead?: ReactNode;
  /** Shown above the heading, e.g. "Step 1 of 2". */
  above?: string;
  /** A Lucide icon above the heading, in a soft circle. */
  icon?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  /** For moving focus to the heading when the screen's state changes. */
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section
      aria-busy={busy || undefined}
      className={cn(
        'flex w-full flex-col gap-6',
        'md:rounded-xl md:border md:bg-card md:p-6 md:text-card-foreground md:shadow-sm',
      )}
    >
      <header className="flex flex-col gap-1.5">
        {icon && (
          <div
            aria-hidden
            className="mb-4 flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5"
          >
            {icon}
          </div>
        )}
        {above && <p className="text-sm text-muted-foreground">{above}</p>}
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {title}
        </h1>
        {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
      </header>
      {children}
    </section>
  );
}
