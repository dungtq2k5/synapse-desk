import { CircleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CharacterCount } from '@/components/ui/character-count';
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
  announce = false,
  count,
  children,
}: {
  id: string;
  label: string;
  /** Beside the label, right-aligned: "Forgot password?". */
  labelAside?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  /**
   * The error is an answer from the server rather than a check as you type,
   * so it is announced (`role="alert"`) as well as tied to the control.
   */
  announce?: boolean;
  /** A length limit: "{n}/{max}" beside the label, read near the limit. */
  count?: { length: number; max: number };
  children: (aria: {
    'aria-describedby'?: string;
    'aria-invalid'?: true;
  }) => ReactNode;
}) {
  const described = [
    count ? `${id}-count` : null,
    description ? `${id}-description` : null,
    error ? `${id}-error` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
        {count && <CharacterCount id={`${id}-count`} {...count} />}
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
        <p
          id={`${id}-error`}
          role={announce ? 'alert' : undefined}
          className="flex items-start gap-1.5 text-sm text-destructive"
        >
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
