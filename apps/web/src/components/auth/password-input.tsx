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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 h-9 w-9 text-muted-foreground"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  );
}
