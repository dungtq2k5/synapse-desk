'use client';

import { CircleAlertIcon, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** A refusal the dialog shows in words, with how to fix it. */
export type Refusal = { title: string; description: ReactNode };

/**
 * The destructive confirmation: the title as a question, the consequence
 * first, Cancel focused. `onConfirm` answers a refusal to show in place,
 * `false` to stay open as it is (its own fields said what's wrong), or
 * nothing when it went through (the dialog then closes).
 *
 * @example <ConfirmDialog open={…} title="Delete Sam?" … onConfirm={remove} />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  icon: Icon,
  destructive = true,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onConfirm: () => Promise<Refusal | false | void>;
  /** Extra fields between the description and the buttons. */
  children?: ReactNode;
}) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const refused = await onConfirm();
      if (refused === false) return;
      if (refused) setRefusal(refused);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRefusal(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {refusal && <RefusalAlert refusal={refusal} />}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void confirm()}
          >
            {Icon && <Icon aria-hidden />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A refusal in words, announced; focus stays where it was. */
export function RefusalAlert({ refusal }: { refusal: Refusal }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{refusal.title}</AlertTitle>
      <AlertDescription>{refusal.description}</AlertDescription>
    </Alert>
  );
}

/**
 * A dialog opened from a menu item gets the focus: it opens once the menu has
 * closed, and the menu doesn't hand focus back to its button. Closing the
 * menu any other way (Esc, a click outside) still returns focus there.
 *
 * @example
 * const menu = useMenuHandoff();
 * <DropdownMenuContent onCloseAutoFocus={menu.onCloseAutoFocus}>
 *   <DropdownMenuItem onSelect={() => menu.handOff(() => setDialog('delete'))}>
 */
export function useMenuHandoff() {
  const pending = useRef<(() => void) | null>(null);
  return {
    handOff: (open: () => void) => {
      pending.current = open;
    },
    onCloseAutoFocus: (event: Event) => {
      const open = pending.current;
      pending.current = null;
      if (!open) return;
      event.preventDefault();
      open();
    },
  };
}
