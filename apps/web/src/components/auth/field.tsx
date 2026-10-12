import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/**
 * A labelled control with its help and its error. The control gets
 * `aria-describedby` and `aria-invalid` from the ids this hands it.
 *
 * @example
 * <Field id="email" label="Email" error={errors.email}>
 *   {(aria) => <Input id="email" {...aria} />}
 * </Field>
 */
export function Field({
  id,
  label,
  labelAside,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  /** Beside the label, right-aligned: "Forgot password?". */
  labelAside?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  children: (aria: {
    'aria-describedby'?: string;
    'aria-invalid'?: true;
  }) => ReactNode;
}) {
  const described = [
    description ? `${id}-description` : null,
    error ? `${id}-error` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {children({
        'aria-describedby': described.length ? described.join(' ') : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {description && (
        <div id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
