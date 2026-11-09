'use client';

import { MenuIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SECTIONS } from './sections';

/**
 * The section links at 390: a button in the header that opens them in a panel
 * under it, the way a popover would. The header stays put, and the
 * button reads Close while the panel is open.
 *
 * Escape or a click outside closes it, and focus returns to the button.
 * Choosing a link closes it first, then scrolls to that section.
 */
export function LandingMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) button.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !button.current?.contains(target)
      ) {
        close(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Menu'}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? <XIcon aria-hidden /> : <MenuIcon aria-hidden />}
      </Button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className={cn(
          'absolute inset-x-0 top-full border-b bg-background shadow-md',
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-(--motion-duration-base)',
        )}
      >
        <nav aria-label="Sections" className="flex flex-col py-2">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="flex h-11 items-center px-4 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                // After the panel is gone, so the scroll measures the page as it will be.
                requestAnimationFrame(() => {
                  document.getElementById(section.id)?.scrollIntoView({
                    behavior: matchMedia('(prefers-reduced-motion: reduce)')
                      .matches
                      ? 'auto'
                      : 'smooth',
                  });
                  history.replaceState(null, '', `#${section.id}`);
                });
              }}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}
