import { cn } from '@/lib/utils';
import {
  type Frame,
  frameAt,
  type Point,
  REST_CAMERA,
  restingState,
  VIEW,
} from './scene-geometry';

const path = (points: Point[], closed = false) =>
  points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join('') + (closed ? 'Z' : '');

/** A diamond around a center: the question shape. */
const diamond = ({ x, y }: Point, size: number) =>
  `M${x.toFixed(1)} ${(y - size / 2).toFixed(1)}l${size / 2} ${size / 2}l${-size / 2} ${size / 2}l${-size / 2} ${-size / 2}Z`;

/**
 * The hero scene at rest, as an inline SVG: what the page paints with its
 * words, and all a device that won't run the live scene ever sees.
 *
 * Drawn from the same frame the canvas starts on ({@link frameAt} at the
 * resting state), in the `scene-*` colors, so one drawing serves both modes.
 * Decoration only: `aria-hidden`, and nothing in it takes focus.
 */
export function SceneStill({ className }: { className?: string }) {
  const frame: Frame = frameAt(restingState(), REST_CAMERA);

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      className={cn('block size-full', className)}
    >
      <defs>
        <filter id="scene-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
        <filter id="scene-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={frame.halo.center.x}
        cy={frame.halo.center.y}
        r={frame.halo.radius}
        className="fill-scene-glow-soft"
        opacity={0.55}
        filter="url(#scene-blur)"
      />
      {frame.motes.map((mote, index) => (
        <circle
          key={index}
          cx={mote.x}
          cy={mote.y}
          r={1.5}
          className="fill-scene-line"
        />
      ))}
      {frame.rings.map((ring, index) => (
        <path
          key={index}
          d={path(ring, true)}
          fill="none"
          className="stroke-scene-line"
          strokeWidth={1}
          opacity={0.8}
        />
      ))}

      <path
        d={path(frame.handoffPath)}
        fill="none"
        className="stroke-scene-handoff"
        strokeWidth={1.5}
        strokeDasharray="4 5"
      />
      <circle
        cx={frame.person.center.x}
        cy={frame.person.center.y}
        r={frame.person.radius * 2.4}
        className="fill-scene-handoff-soft"
        opacity={frame.person.halo}
        filter="url(#scene-blur)"
      />
      <circle
        cx={frame.person.center.x}
        cy={frame.person.center.y}
        r={frame.person.radius}
        className="fill-scene-surface stroke-scene-handoff"
        strokeWidth={1.5}
      />
      <g
        className="stroke-scene-handoff"
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        <circle
          cx={frame.person.center.x}
          cy={frame.person.center.y - frame.person.radius * 0.18}
          r={frame.person.radius * 0.2}
        />
        <path
          d={`M${frame.person.center.x - frame.person.radius * 0.36} ${frame.person.center.y + frame.person.radius * 0.36}a${frame.person.radius * 0.36} ${frame.person.radius * 0.3} 0 0 1 ${frame.person.radius * 0.72} 0`}
        />
      </g>

      <g filter="url(#scene-glow)">
        {frame.faces.map((face, index) => (
          <path
            key={index}
            d={path(face.points, true)}
            className="fill-scene-surface stroke-scene-glow"
            fillOpacity={0.75 + face.shade * 0.25}
            strokeWidth={1.25}
            strokeLinejoin="round"
          />
        ))}
      </g>

      <path
        d={path([frame.beam.from, frame.beam.to])}
        className="stroke-scene-line"
        strokeWidth={1.25}
      />
      <rect
        x={frame.card.x}
        y={frame.card.y}
        width={frame.card.width}
        height={frame.card.height}
        rx={8}
        className="fill-scene-surface stroke-scene-line"
        strokeWidth={1}
      />
      {[0, 1, 2, 3, 4].map((line) => (
        <rect
          key={line}
          x={frame.card.x + 14}
          y={frame.card.y + 14 + line * 13}
          width={(frame.card.width - 28) * [0.9, 0.75, 1, 0.6, 0.8][line]}
          height={4}
          rx={2}
          className={
            line === frame.card.litLine ? 'fill-scene-glow' : 'fill-scene-line'
          }
          opacity={line === frame.card.litLine ? 1 : 0.6}
        />
      ))}

      {frame.questions.map((question, index) => (
        <g key={index} opacity={question.opacity}>
          <path
            d={path([question.trail, question.center])}
            className="stroke-scene-line"
            strokeWidth={1.25}
          />
          <path
            d={diamond(question.center, question.size)}
            className="fill-scene-glow"
            filter="url(#scene-glow)"
          />
        </g>
      ))}
    </svg>
  );
}
