'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Whether this device should run the live scene: motion
 * allowed, a wide viewport with a fine pointer, no Save-Data, at least 4
 * cores, and at least 4 GB where the browser says.
 */
function deviceCanRun(): boolean {
  const navigatorInfo = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return (
    matchMedia('(prefers-reduced-motion: no-preference)').matches &&
    matchMedia('(min-width: 1024px) and (pointer: fine)').matches &&
    !navigatorInfo.connection?.saveData &&
    (navigator.hardwareConcurrency ?? 0) >= 4 &&
    (navigatorInfo.deviceMemory === undefined ||
      navigatorInfo.deviceMemory >= 4)
  );
}

/** Resolves once the page's `load` has fired. */
const loaded = () =>
  new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

/**
 * The hero scene: the still (`children`, server-rendered) at first paint, and
 * where the device can run it, the live canvas after the page's `load`.
 *
 * The canvas mounts only once every check has passed, so under reduced motion
 * or on a phone there is no `canvas` at all. It draws its first frame (the
 * still) under the image, then the image fades out over `slow`. A failure
 * anywhere, or frames that run slow, keeps or brings back the still and says
 * nothing.
 */
export function SceneLoader({
  hero,
  children,
}: {
  /** The hero section's id: the scene leans and dollies with it. */
  hero: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!deviceCanRun()) return;
    void loaded().then(() => {
      if (!cancelled) setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const section = document.getElementById(hero);
    if (!mounted || !element || !section) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    import('./scene')
      .then(({ startScene }) => {
        if (cancelled) return;
        stop = startScene(element, {
          hero: section,
          onReady: () => setLive(true),
          onSlow: () => {
            setLive(false);
            setMounted(false);
          },
        });
      })
      .catch(() => {
        setLive(false);
        setMounted(false);
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [mounted, hero]);

  return (
    <div className="relative size-full">
      {mounted && (
        <canvas
          ref={canvas}
          aria-hidden="true"
          className="absolute inset-0 size-full"
        />
      )}
      <div
        className={cn(
          'relative size-full transition-opacity duration-(--motion-duration-slow) ease-standard',
          live && 'opacity-0',
        )}
      >
        {children}
      </div>
    </div>
  );
}
