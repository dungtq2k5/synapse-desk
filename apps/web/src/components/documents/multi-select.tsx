'use client';

import { ChevronDownIcon, XIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Several choices from a short list: chips, each with its own remove button,
 * and a button that opens the list as checkable items. At `max` chosen the
 * rest are disabled.
 *
 * @example <MultiSelect id="ocr" label="OCR languages" options={…} value={chosen} onChange={setChosen} max={4} />
 */
export function MultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  max,
  heading,
  placeholder,
  disabled = false,
  invalid = false,
  describedBy,
  allowed = () => true,
}: {
  id: string;
  /** The field's name, for the open button and the list. */
  label: string;
  options: { value: string; label: string }[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  max?: number;
  /** Above the list: "Up to 4 languages", then "4 of 4 chosen". */
  heading?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Whether an option may join the current choice. */
  allowed?: (option: string, chosen: readonly string[]) => boolean;
}) {
  const names = new Map(options.map((option) => [option.value, option.label]));
  const full = max !== undefined && value.length >= max;

  return (
    <div
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-9 w-full items-center gap-1 rounded-md border border-input bg-transparent py-1 pr-1 pl-2 shadow-xs dark:bg-input/30',
        invalid && 'border-destructive',
        disabled && 'opacity-50',
      )}
    >
      <ul className="flex flex-1 flex-wrap gap-1">
        {value.length === 0 && placeholder && (
          <li className="px-1 text-sm text-muted-foreground">{placeholder}</li>
        )}
        {value.map((chosen) => (
          <li
            key={chosen}
            className="inline-flex items-center gap-1 rounded-md bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
          >
            {names.get(chosen) ?? chosen}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${names.get(chosen) ?? chosen}`}
              className="rounded-sm p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onChange(value.filter((item) => item !== chosen))}
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            aria-label={`Choose ${label.toLowerCase()}`}
            aria-describedby={describedBy}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDownIcon aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          aria-label={label}
          className="w-60 shadow-md"
        >
          {heading && (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {full && max !== undefined ? `${max} of ${max} chosen` : heading}
            </DropdownMenuLabel>
          )}
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={checked}
                disabled={!checked && (full || !allowed(option.value, value))}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? [...value, option.value]
                      : value.filter((item) => item !== option.value),
                  )
                }
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
