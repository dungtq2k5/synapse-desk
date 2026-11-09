'use client';

import {
  FlagIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  SparklesIcon,
  UserRoundIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';

const STEPS: { label: string; sentence: string; icon: LucideIcon }[] = [
  {
    label: '1. Someone asks',
    sentence:
      'A question comes in through Ask, or as an email to your support address.',
    icon: MessageCircleQuestionIcon,
  },
  {
    label: '2. The AI answers first',
    sentence:
      'It answers from your organization’s documents and shows the passages it used.',
    icon: SparklesIcon,
  },
  {
    label: '3. A person takes over',
    sentence:
      'When the AI can’t answer, the ticket goes to your team with a summary and suggestions.',
    icon: UserRoundIcon,
  },
  {
    label: '4. The knowledge base improves',
    sentence:
      'Quality flags show which documents are out of date, never found, or in conflict, so you know what to fix.',
    icon: FlagIcon,
  },
];

// ------------------------------------------------------ the light's timing

/** `standard` (0.2, 0, 0, 1) for a move; linear for a pause. */
const MOVE = '0.2 0 0 1';
const HOLD = '0 0 1 1';

/** A cubic's length, by sampling: enough to place the light's key points. */
function cubicLength(points: number[][], samples = 64): number {
  let length = 0;
  let previous = points[0];
  for (let index = 1; index <= samples; index += 1) {
    const t = index / samples;
    const u = 1 - t;
    const point = [0, 1].map(
      (axis) =>
        u * u * u * points[0][axis] +
        3 * u * u * t * points[1][axis] +
        3 * u * t * t * points[2][axis] +
        t * t * t * points[3][axis],
    );
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return length;
}

/**
 * 1440: 1 → 2 → 3 → 4 along the solid path, 1.2 s a
 * segment, 0.4 s at each node; then the dashed return 4 → 2 in 1.6 s. One
 * loop is 6.4 s.
 */
const WIDE = (() => {
  const solid = 900;
  const up = 36;
  const curve = cubicLength([
    [1050, 114],
    [1050, 0],
    [450, 0],
    [450, 114],
  ]);
  const total = solid + up + curve;
  const at = (distance: number) => (distance / total).toFixed(4);
  const seconds = [0, 1.2, 1.6, 2.8, 3.2, 4.4, 4.8, 6.4];
  return {
    path: 'M150 150 L1050 150 L1050 114 C1050 0 450 0 450 114',
    duration: 6.4,
    keyTimes: seconds.map((s) => (s / 6.4).toFixed(4)).join(';'),
    keyPoints: [0, 300, 300, 600, 600, 900, 900, total].map(at).join(';'),
    keySplines: [MOVE, HOLD, MOVE, HOLD, MOVE, HOLD, MOVE].join(';'),
    arrivals: [1.2, 2.8, 4.4],
    nodes: [450, 750, 1050].map((x) => ({ x, y: 150 })),
  };
})();

/**
 * 390: down the rail, 1.0 s a segment with the same pauses; at 4 it holds
 * for the node's 0.4 s pulse, fading out as it ends, and starts again at 1.
 */
const TALL = (() => {
  const rows = [24, 128, 232, 336];
  const seconds = [0, 1.0, 1.4, 2.4, 2.8, 3.8, 4.2];
  return {
    path: `M24 ${rows[0]} L24 ${rows[3]}`,
    duration: 4.2,
    keyTimes: seconds.map((s) => (s / 4.2).toFixed(4)).join(';'),
    keyPoints: [0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1, 1]
      .map((p) => p.toFixed(4))
      .join(';'),
    keySplines: [MOVE, HOLD, MOVE, HOLD, MOVE, HOLD].join(';'),
    arrivals: [1.0, 2.4, 3.8],
    nodes: rows.slice(1).map((y) => ({ x: 24, y })),
  };
})();

type Timing = typeof WIDE | typeof TALL;

/** The light and the node pulses for one layout, as SVG animations. */
function Light({ timing }: { timing: Timing }) {
  const fade = (0.18 / timing.duration).toFixed(4);
  return (
    <g aria-hidden="true">
      {timing.nodes.map((node, index) => {
        const start = timing.arrivals[index] / timing.duration;
        const peak = (timing.arrivals[index] + 0.2) / timing.duration;
        const end = (timing.arrivals[index] + 0.4) / timing.duration;
        return (
          <circle
            key={index}
            cx={node.x}
            cy={node.y}
            r={timing === WIDE ? 42 : 30}
            fill="none"
            strokeWidth={2}
            className="stroke-scene-glow"
            opacity={0}
          >
            <animate
              attributeName="opacity"
              dur={`${timing.duration}s`}
              begin="indefinite"
              repeatCount="indefinite"
              values="0;0;0.6;0;0"
              keyTimes={`0;${start.toFixed(4)};${peak.toFixed(4)};${end.toFixed(4)};1`}
            />
          </circle>
        );
      })}
      <circle r={10} className="fill-scene-glow-soft" opacity={0}>
        <animateMotion
          dur={`${timing.duration}s`}
          begin="indefinite"
          repeatCount="indefinite"
          path={timing.path}
          keyTimes={timing.keyTimes}
          keyPoints={timing.keyPoints}
          keySplines={timing.keySplines}
          calcMode="spline"
        />
        <animate
          attributeName="opacity"
          dur={`${timing.duration}s`}
          begin="indefinite"
          repeatCount="indefinite"
          values="0;0.8;0.8;0"
          keyTimes={`0;${fade};${(1 - Number(fade)).toFixed(4)};1`}
        />
      </circle>
      <circle r={5} className="fill-scene-glow" opacity={0}>
        <animateMotion
          dur={`${timing.duration}s`}
          begin="indefinite"
          repeatCount="indefinite"
          path={timing.path}
          keyTimes={timing.keyTimes}
          keyPoints={timing.keyPoints}
          keySplines={timing.keySplines}
          calcMode="spline"
        />
        <animate
          attributeName="opacity"
          dur={`${timing.duration}s`}
          begin="indefinite"
          repeatCount="indefinite"
          values="0;1;1;0"
          keyTimes={`0;${fade};${(1 - Number(fade)).toFixed(4)};1`}
        />
      </circle>
    </g>
  );
}

/**
 * The light runs while the graph is at least 30% in view and the tab is
 * shown, and pauses otherwise. It's started on first sight, so every loop
 * begins at step 1.
 */
function useLight(
  graph: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const root = graph.current;
    if (!enabled || !root) return;
    const svgs = [...root.querySelectorAll('svg')];
    let started = false;
    let inView = false;
    const update = () => {
      const running = inView && !document.hidden;
      for (const svg of svgs) {
        if (running && !started) {
          for (const animation of svg.querySelectorAll(
            'animate, animateMotion',
          )) {
            (animation as SVGAnimationElement).beginElement();
          }
        }
        if (running) svg.unpauseAnimations();
        else svg.pauseAnimations();
      }
      if (running) started = true;
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        update();
      },
      { threshold: 0.3 },
    );
    observer.observe(root);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [graph, enabled]);
}

/**
 * How it works: one question's journey as four steps. An ordered list for everyone, drawn over an SVG of the paths.
 *
 * 1440: four nodes in a row with a dashed return path above, from 4 back to
 * 2; each step is focusable, and hover or focus highlights it and shows its
 * sentence. 390: a vertical rail with every sentence shown. The light is
 * decoration (`aria-hidden`), and isn't rendered under reduced motion.
 */
export function FlowGraph() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const graph = useRef<HTMLDivElement>(null);
  useLight(graph, !reduced);

  return (
    <div ref={graph} className="relative mt-10">
      {/* 1440: the row, with the return path above. */}
      <svg
        viewBox="0 0 1200 300"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 hidden h-75 w-full xl:block"
      >
        <path
          d="M186 150 H1014"
          className="stroke-scene-line"
          strokeWidth={2}
          fill="none"
        />
        <path
          d="M1050 114 C1050 0 450 0 450 114"
          className="stroke-scene-line"
          strokeWidth={1.5}
          strokeDasharray="6 6"
          fill="none"
        />
        {!reduced && <Light timing={WIDE} />}
      </svg>
      <p
        aria-hidden="true"
        className="absolute top-8 left-[62.5%] hidden -translate-x-1/2 text-xs text-muted-foreground xl:block"
      >
        The next answer uses what was fixed
      </p>

      {/* 390: the rail. */}
      <svg
        viewBox="0 0 48 360"
        aria-hidden="true"
        focusable="false"
        className="absolute top-0 left-0 h-90 w-12 xl:hidden"
      >
        <path
          d="M24 24 V336"
          className="stroke-scene-line"
          strokeWidth={2}
          fill="none"
        />
        {!reduced && <Light timing={TALL} />}
      </svg>

      <ol className="relative flex flex-col xl:block xl:h-75">
        {STEPS.map((step, index) => {
          const lit = active === index;
          const Icon = step.icon;
          return (
            <li
              key={step.label}
              // Focusable at both widths: at 1440 focus shows the sentence, at 390 it rings the node.
              tabIndex={0}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() =>
                setActive((was) => (was === index ? null : was))
              }
              onFocus={() => setActive(index)}
              onBlur={() => setActive((was) => (was === index ? null : was))}
              data-active={lit || undefined}
              className={cn(
                'group flex min-h-26 gap-4 rounded-md outline-none xl:absolute xl:top-28.5 xl:w-60 xl:flex-col xl:items-center xl:gap-0 xl:text-center',
                '',
              )}
              // The row's slots: each step centered on its node, 300 px apart.
              style={{ left: `${(30 + 300 * index) / 12}%` }}
              data-step={index + 1}
            >
              <span
                className={cn(
                  'relative flex size-12 shrink-0 items-center justify-center rounded-full border bg-card xl:size-18',
                  'transition-[background-color,box-shadow,border-color] duration-(--motion-duration-fast) ease-standard motion-reduce:transition-none',
                  'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background',
                  lit &&
                    'border-transparent bg-accent shadow-[0_0_0_2px_var(--scene-glow),0_0_16px_var(--scene-glow-soft)]',
                )}
              >
                <Icon aria-hidden className="size-5 xl:size-6" />
              </span>
              <span className="flex flex-col gap-1 xl:mt-4">
                <span className="text-sm font-medium">{step.label}</span>
                <span
                  className={cn(
                    'text-sm text-muted-foreground xl:px-2',
                    'xl:opacity-0 xl:translate-y-1 xl:transition-[opacity,translate] xl:duration-(--motion-duration-fast) xl:ease-exit',
                    'motion-reduce:xl:translate-y-0',
                    lit &&
                      'xl:translate-y-0 xl:opacity-100 xl:duration-(--motion-duration-base) xl:ease-enter',
                  )}
                >
                  {step.sentence}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 border-l-2 border-dashed border-scene-line pl-4 text-sm text-muted-foreground xl:hidden">
        Then back to step 2: the next answer uses what was fixed.
      </p>
    </div>
  );
}
