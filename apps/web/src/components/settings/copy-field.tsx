'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * A value to copy: read-only and monospaced, with Copy that turns into
 * Copied for a moment and says so politely. Under 400 px the value wraps
 * above the button.
 *
 * @example <CopyField label="Inbound address" value={address} />
 */
export function CopyField({
  label,
  value,
  onCopied,
}: {
  /** The value's accessible name. */
  label: string;
  value: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = globalThis.setTimeout(() => setCopied(false), 2000);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    announce('Copied');
    onCopied?.();
  };

  return (
    <div className="flex flex-col gap-2 min-[400px]:flex-row">
      <output
        aria-label={label}
        className={cn(
          'flex min-h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-muted px-3 py-2 font-mono text-sm break-all',
          'min-[400px]:truncate min-[400px]:break-normal',
        )}
      >
        {value}
      </output>
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
