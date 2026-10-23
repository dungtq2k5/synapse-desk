import { ShieldCheckIcon } from 'lucide-react';

/**
 * The bar across every console page, in inverse colors, so a Super Admin
 * can't mistake the console for one organization. A landmark, announced
 * as "Platform console".
 */
export function ConsoleBar() {
  return (
    <div
      role="region"
      aria-label="Platform console"
      className="flex min-h-9 items-center gap-2 bg-foreground px-4 py-2 text-sm text-background md:px-6"
    >
      <ShieldCheckIcon aria-hidden className="size-4 shrink-0" />
      <span className="font-medium">Platform console</span>
      <span className="hidden md:inline">
        Changes here reach organizations directly.
      </span>
      <span className="ml-auto text-xs font-medium md:text-sm">
        Super Admin
      </span>
    </div>
  );
}
