'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Toasts: a popover surface with a border, and a solid 28 px square in the
 * kind's color with its 16 px icon centered. Bottom right; full width at the
 * bottom on phones.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Spinner className="size-4" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'group/toast shadow-lg',
          // `!` throughout: sonner's own `[data-sonner-toast][data-styled]
          // [data-icon]` rule sets a 16 px box, `justify-content: flex-start`
          // and negative margins, and outranks a plain utility, putting the
          // icon against the tile's left edge.
          icon: [
            'size-7! ms-0! justify-center! rounded-md flex items-center [&_svg]:m-0!',
            'group-data-[type=success]/toast:bg-success group-data-[type=success]/toast:text-success-foreground',
            'group-data-[type=warning]/toast:bg-warning group-data-[type=warning]/toast:text-warning-foreground',
            'group-data-[type=info]/toast:bg-info group-data-[type=info]/toast:text-info-foreground',
            'group-data-[type=error]/toast:bg-destructive group-data-[type=error]/toast:text-destructive-foreground',
          ].join(' '),
          description: 'text-muted-foreground!',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
