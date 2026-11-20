'use client';

import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { MultiSelect } from './multi-select';

/** "A", "A and B", "A, B and C". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * "Who can see them": everyone in the organization, or only some
 * departments, each with its consequence. The departments' list opens under
 * the second choice, and the consequence is restated, politely, as it
 * changes. `locked` disables the two choices (the share-only manager), and
 * names why.
 */
export function VisibilityField({
  legend,
  noun,
  organization,
  organizationWide,
  departmentIds,
  departments,
  onChange,
  disabled = false,
  locked,
  error,
  legendHidden = false,
}: {
  legend: string;
  /** Under a heading that already says it: the legend is for screen readers. */
  legendHidden?: boolean;
  /** "them" for an upload, "it" for one document. */
  noun: 'them' | 'it';
  organization: string;
  organizationWide: boolean;
  departmentIds: readonly string[];
  departments: ReadonlyMap<string, string>;
  onChange: (next: {
    organizationWide: boolean;
    departmentIds: string[];
  }) => void;
  disabled?: boolean;
  /** Why the two choices can't be changed; the departments stay editable. */
  locked?: ReactNode;
  error?: string | null;
}) {
  const id = useId();
  const lockId = `${id}-lock`;
  const errorId = `${id}-error`;
  const chosen = departmentIds.map(
    (departmentId) => departments.get(departmentId) ?? 'Unknown department',
  );
  const these = noun === 'them' ? 'these documents' : 'it';

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className={legendHidden ? 'sr-only' : 'mb-3 text-sm font-medium'}>
        {legend}
      </legend>
      {locked && (
        <p id={lockId} className="text-sm text-muted-foreground">
          {locked}
        </p>
      )}
      <RadioGroup
        value={organizationWide ? 'everyone' : 'departments'}
        onValueChange={(value) =>
          onChange({
            organizationWide: value === 'everyone',
            departmentIds: [...departmentIds],
          })
        }
        disabled={disabled || Boolean(locked)}
        aria-describedby={locked ? lockId : undefined}
        className="gap-3"
      >
        <Choice
          dimmed={Boolean(locked)}
          id={`${id}-everyone`}
          value="everyone"
          label={`Everyone in ${organization}`}
          hint={`Organization-wide. Everyone can find ${noun} and get answers from ${noun}.`}
        />
        <Choice
          dimmed={Boolean(locked)}
          id={`${id}-departments`}
          value="departments"
          label="Only some departments"
          hint={`People outside those departments won’t get answers from ${noun}.`}
        />
      </RadioGroup>
      {!organizationWide && (
        <div className="ml-7 flex flex-col gap-2">
          <Label htmlFor={`${id}-pick`}>Departments</Label>
          <MultiSelect
            id={`${id}-pick`}
            label="Departments"
            placeholder="Choose departments"
            options={[...departments].map(([value, label]) => ({
              value,
              label,
            }))}
            value={departmentIds}
            onChange={(next) =>
              onChange({ organizationWide: false, departmentIds: next })
            }
            disabled={disabled}
            invalid={Boolean(error)}
            describedBy={error ? errorId : undefined}
          />
          {error && (
            <p
              id={errorId}
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <div aria-live="polite">
            {chosen.length > 0 && (
              <Alert className="border-info-border bg-info-subtle text-info-subtle-foreground">
                <InfoIcon aria-hidden />
                <AlertTitle className="line-clamp-none">
                  {`Only people in ${andList(chosen)} get answers from ${these}.`}
                </AlertTitle>
                <AlertDescription className="text-info-subtle-foreground">
                  {`Everyone else won’t see ${noun} in Search or Ask.`}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function Choice({
  id,
  value,
  label,
  hint,
  dimmed,
}: {
  /** Locked: the control and its label at half strength; the hint stays legible. */
  dimmed: boolean;
  id: string;
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem
        id={id}
        value={value}
        aria-describedby={`${id}-hint`}
        className={cn('mt-0.5', dimmed && 'opacity-50')}
      />
      <div className="flex flex-col gap-0.5">
        <Label
          htmlFor={id}
          className={cn('font-normal', dimmed && 'opacity-50')}
        >
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}
