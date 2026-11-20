import { Separator } from '@/components/ui/separator';

/** The "or" between Google and the email form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="flex-1" />
      or
      <Separator className="flex-1" />
    </div>
  );
}
