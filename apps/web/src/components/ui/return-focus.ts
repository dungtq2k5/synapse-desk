import { useCallback, useRef } from 'react';

/** Each open layer's return target, by its content element. */
const RETURN_TO = new WeakMap<Element, HTMLElement | null>();

/**
 * The last layer's target: a layer opened as the one before it closed (one
 * render) mounts after that one left the DOM, with focus on the page.
 */
let latest: HTMLElement | null = null;

/** A dialog, alert dialog or sheet's content element. */
const LAYER =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"]';

/**
 * Where focus goes when a dialog, alert dialog or sheet closes: the element
 * that had it when the layer opened. Radix returns focus only to a
 * `…Trigger`, and most layers here open from a plain button (controlled), so
 * focus fell to the page. Opened from inside another layer (a flow of
 * dialogs), it returns where that one would.
 *
 * Spread both onto the primitive's `Content`:
 * `ref` records the target as the content mounts (before focus moves in);
 * `onCloseAutoFocus` focuses it, unless the caller's own handler prevented
 * that, or the target is gone (then Radix's default stands).
 *
 * @example const returnFocus = useReturnFocus(props.onCloseAutoFocus);
 *          <DialogPrimitive.Content {...props} {...returnFocus} />
 */
export function useReturnFocus(
  onCloseAutoFocus: ((event: Event) => void) | undefined,
) {
  const target = useRef<HTMLElement | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const active = document.activeElement as HTMLElement | null;
    const layer = active?.closest(LAYER);
    target.current =
      (layer && RETURN_TO.get(layer)) ||
      (active && active !== document.body ? active : latest);
    RETURN_TO.set(node, target.current);
    latest = target.current;
  }, []);

  const onClose = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const element = target.current;
      if (element?.isConnected && element !== document.body) {
        event.preventDefault();
        element.focus();
      }
    },
    [onCloseAutoFocus],
  );

  return { ref, onCloseAutoFocus: onClose };
}
