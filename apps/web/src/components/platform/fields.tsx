'use client';

import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/auth/field';

/**
 * A number with its unit inside the box ("GB", "USD"). The unit is said to a
 * screen reader through the label, so the suffix itself is decoration.
 */
export function UnitInput({
  unit,
  className,
  ...props
}: ComponentProps<typeof Input> & { unit?: string }) {
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        className={unit ? `pr-14 ${className ?? ''}` : className}
        {...props}
      />
      {unit && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-2 right-3 text-sm text-muted-foreground"
        >
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * The reason every console change asks for: a real textarea labeled
 * "Reason", its help tied to it, and "A reason is required." when it's
 * missing.
 */
export function ReasonField({
  id,
  value,
  onChange,
  error,
  help = 'Recorded in the audit log, with your name.',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  help?: string;
}) {
  return (
    <Field id={id} label="Reason" description={help} error={error}>
      {(aria) => (
        <Textarea
          id={id}
          placeholder="Why, for the audit log"
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...aria}
        />
      )}
    </Field>
  );
}

const GIB = 1024 ** 3;

/** GB typed into bytes; null for an empty box, NaN for a bad one. */
export function bytesOf(gb: string): number | null {
  if (!gb.trim()) return null;
  const value = Number(gb);
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * GIB)
    : Number.NaN;
}

/** USD typed into the AI allowance's millionths; null when empty. */
export function microsOf(usd: string): number | null {
  if (!usd.trim()) return null;
  const value = Number(usd);
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000_000)
    : Number.NaN;
}

/** A whole number typed in; null when empty. */
export function wholeOf(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
}

/** Bytes as the GB a box shows. */
export const gbOf = (bytes: number) => String(Number((bytes / GIB).toFixed(2)));

/** The AI allowance as the USD a box shows. */
export const usdOf = (micros: number) => (micros / 1_000_000).toFixed(2);
