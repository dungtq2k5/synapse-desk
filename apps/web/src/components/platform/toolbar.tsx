'use client';

import { SearchIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/**
 * A console list's toolbar: search, selects, then a switch on the right at
 * desktop. At 390 each takes the full width, in that order.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      {children}
    </div>
  );
}

/**
 * Search, sent 300 ms after the typing stops. `resetKey` empties it (Clear
 * filters).
 */
export function SearchBox({
  label,
  value,
  onSearch,
}: {
  label: string;
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const next = text.trim() || undefined;
      if (next !== value) onSearch(next);
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [text, value, onSearch]);

  return (
    <div className="relative w-full md:w-70">
      <SearchIcon
        aria-hidden
        className="absolute top-2.5 left-3 size-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        className="pl-9"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}

/** A select whose first option means "no filter". */
export function ChoiceFilter({
  label,
  all,
  value,
  options,
  onValue,
}: {
  /** The accessible name: "Status". */
  label: string;
  /** The no-filter option's words: "All statuses". */
  all: string;
  value: string | undefined;
  options: [string, string][];
  onValue: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ''}
      onValueChange={(next) => onValue(next === 'all' ? undefined : next)}
    >
      <SelectTrigger aria-label={label} className="w-full md:w-42.5">
        <SelectValue placeholder={all} />
      </SelectTrigger>
      <SelectContent className="shadow-md">
        <SelectItem value="all">{all}</SelectItem>
        {options.map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Show offboarded": a switch with its label, at the toolbar's end. */
export function SwitchFilter({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 md:ml-auto">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
