'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const number = (value: number) => value.toLocaleString('en-US');

/**
 * "{n}/{max}" for a field with a limit. The field points at it with
 * `aria-describedby`; a screen reader also hears it said once at 90% and once
 * at the limit, never on every keystroke.
 */
export function CharacterCount({
  id,
  length,
  max,
}: {
  id: string;
  length: number;
  max: number;
}) {
  const text = `${number(length)}/${number(max)}`;
  const level = length >= max ? 2 : length >= max * 0.9 ? 1 : 0;
  const said = useRef(level);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    if (level > said.current) setSpoken(text);
    said.current = level;
  }, [level, text]);

  return (
    <>
      <span
        id={id}
        className={cn(
          'text-xs tabular-nums text-muted-foreground',
          length > max && 'text-destructive',
        )}
      >
        {text}
      </span>
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </>
  );
}
