'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** A password field with a show/hide button inside its right edge. */
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className="pr-10" />
      {/* Inset, not flush: 28px centered 4px from the right edge, so the
          hover background and the 3px focus ring stay inside the border. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}
