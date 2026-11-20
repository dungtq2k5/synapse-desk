import { useId, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';

/** One section of an account page: a card named by its h2. */
export function SectionCard({
  title,
  badge,
  lead,
  children,
}: {
  title: string;
  /** Beside the title, such as two-step's On or Off. */
  badge?: ReactNode;
  lead?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="max-w-2xl">
      <Card>
        <CardContent className="flex flex-col gap-5">
          <header className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={id} className="text-base font-semibold">
                {title}
              </h2>
              {badge}
            </div>
            {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
          </header>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
