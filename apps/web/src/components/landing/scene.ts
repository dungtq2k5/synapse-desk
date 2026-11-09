import {
  type Camera,
  type Frame,
  frameAt,
  type Point,
  questionStart,
  REST_CAMERA,
  restingState,
  type SceneState,
  SEED,
  seeded,
  VIEW,
} from './scene-geometry';

/**
 * The live hero scene, in WebGL 2: the still image brought to life. Imported only after the page's `load`, and only where
 * `scene-loader.tsx`'s checks pass; nothing on the page needs it.
 *
 * Every frame is {@link frameAt}'s shapes for the current state and camera,
 * drawn as triangles in one call: lines as thin quads, glows as soft sprites,
 * alpha-blended back to front as the still layers them. It starts on the
 * resting state, so its first frame is the still.
 *
 * @example const stop = startScene(canvas, { hero, onReady, onSlow }); stop();
 */
export interface SceneOptions {
  /** The hero section: the pointer leans over it, and scrolling it dollies. */
  hero: HTMLElement;
  /** The first frame is on screen: the still may fade out. */
  onReady: () => void;
  /** Frames averaged over 24 ms for 2 s: stopped, the still should come back. */
  onSlow: () => void;
}

const FRAME_MS = 1000 / 60;
const MAX_PIXEL_RATIO = 1.5;
const SLOW_MS = 24;
const SLOW_WINDOW_MS = 2000;
/** A longer gap is a paused or throttled tab, not a slow device. */
const PAUSE_MS = 250;

/**
 * The scene's frame pacing: at most 60 frames a second, and
 * "slow" when the display's own frames average over 24 ms for 2 s.
 *
 * **The two are measured apart, and that is the point.** Slowness is read
 * from every animation frame's gap, rendered or skipped: a device that can't
 * keep up stretches those whatever the cap does. Measured on rendered frames
 * instead, a 75 Hz display (13 ms frames, every other one skipped by a plain
 * cap) reads 26 ms and gets the still back for no reason. The cap keeps a
 * 1/60 s schedule, so a faster display still draws close to 60 a second.
 *
 * @example const { render, slow, dt } = pacer.tick(now)
 */
export class FramePacer {
  private lastRender: number | null = null;
  private due = 0;
  private previous: number | null = null;
  private gaps: number[] = [];
  private total = 0;

  /** This animation frame: whether to draw, whether running slow, and seconds since the last draw. */
  tick(now: number): { render: boolean; slow: boolean; dt: number } {
    if (this.previous !== null) {
      const gap = now - this.previous;
      if (gap > PAUSE_MS) {
        this.gaps = [];
        this.total = 0;
      } else {
        this.gaps.push(gap);
        this.total += gap;
        while (this.total > SLOW_WINDOW_MS && this.gaps.length > 1) {
          this.total -= this.gaps.shift() ?? 0;
        }
      }
    }
    this.previous = now;
    const slow =
      this.total >= SLOW_WINDOW_MS * 0.9 &&
      this.total / this.gaps.length > SLOW_MS;

    if (this.lastRender === null) {
      this.lastRender = now;
      this.due = now + FRAME_MS;
      return { render: true, slow, dt: 0 };
    }
    // A frame is due every 1/60 s; a display frame within 1 ms of that draws.
    if (now < this.due - 1) return { render: false, slow, dt: 0 };
    const dt = Math.min(now - this.lastRender, 100) / 1000;
    this.lastRender = now;
    // Fallen a whole frame behind (a stall): start afresh rather than catch up.
    this.due = now - this.due > FRAME_MS ? now + FRAME_MS : this.due + FRAME_MS;
    return { render: true, slow, dt };
  }

  /** After a pause: the next frame starts a fresh measure. */
  reset(): void {
    this.lastRender = null;
    this.previous = null;
    this.gaps = [];
    this.total = 0;
  }
}
const DEG = Math.PI / 180;

/**
 * A token's hex color to 0..1 channels. `#rrggbb` as the tokens write it, or
 * `#rgb`, which the production CSS minifier makes of `#ffffff`.
 *
 * @example channels(white) // [1, 1, 1] for `#fff` or `#ffffff`
 */
export function channels(hex: string): [number, number, number] {
  let digits = hex.trim().replace('#', '');
  if (digits.length === 3)
    digits = [...digits].map((digit) => digit + digit).join('');
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

type Rgba = [number, number, number, number];

const VERTEX = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in float a_soft;
in vec4 a_color;
uniform vec2 u_scale;
uniform vec2 u_offset;
out vec2 v_uv;
out float v_soft;
out vec4 v_color;
void main() {
  vec2 clip = a_position * u_scale + u_offset;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
  v_soft = a_soft;
  v_color = a_color;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in float v_soft;
in vec4 v_color;
out vec4 color;
void main() {
  float falloff = 1.0 - clamp(length(v_uv), 0.0, 1.0);
  float alpha = v_color.a * mix(1.0, falloff * falloff, v_soft);
  color = vec4(v_color.rgb * alpha, alpha);
}`;

/** One frame's triangles: x, y, u, v, soft, r, g, b, a per vertex. */
class Batch {
  private data = new Float32Array(9 * 6 * 4096);
  count = 0;

  private vertex(
    x: number,
    y: number,
    u: number,
    v: number,
    soft: number,
    c: Rgba,
  ) {
    if ((this.count + 1) * 9 > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set([x, y, u, v, soft, c[0], c[1], c[2], c[3]], this.count * 9);
    this.count += 1;
  }

  triangle(a: Point, b: Point, c: Point, color: Rgba) {
    this.vertex(a.x, a.y, 0, 0, 0, color);
    this.vertex(b.x, b.y, 0, 0, 0, color);
    this.vertex(c.x, c.y, 0, 0, 0, color);
  }

  quad(a: Point, b: Point, c: Point, d: Point, color: Rgba) {
    this.triangle(a, b, c, color);
    this.triangle(a, c, d, color);
  }

  line(from: Point, to: Point, width: number, color: Rgba) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const nx = (-(to.y - from.y) / length) * (width / 2);
    const ny = ((to.x - from.x) / length) * (width / 2);
    this.quad(
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
      color,
    );
  }

  polyline(points: Point[], width: number, color: Rgba, closed = false) {
    for (let index = 1; index < points.length; index += 1) {
      this.line(points[index - 1], points[index], width, color);
    }
    if (closed) this.line(points[points.length - 1], points[0], width, color);
  }

  dashed(
    points: Point[],
    width: number,
    dash: number,
    gap: number,
    color: Rgba,
  ) {
    let carried = 0;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      let at = carried;
      while (at < length) {
        const end = Math.min(at + dash, length);
        const lerp = (t: number) => ({
          x: from.x + ((to.x - from.x) * t) / length,
          y: from.y + ((to.y - from.y) * t) / length,
        });
        this.line(lerp(at), lerp(end), width, color);
        at += dash + gap;
      }
      carried = at - length;
    }
  }

  /** A soft round glow: full color at the center, nothing at `radius`. */
  sprite(center: Point, radius: number, color: Rgba) {
    const { x, y } = center;
    const corner = (dx: number, dy: number) => ({
      x: x + dx * radius,
      y: y + dy * radius,
    });
    const vertices: [Point, number, number][] = [
      [corner(-1, -1), -1, -1],
      [corner(1, -1), 1, -1],
      [corner(1, 1), 1, 1],
      [corner(-1, -1), -1, -1],
      [corner(1, 1), 1, 1],
      [corner(-1, 1), -1, 1],
    ];
    for (const [point, u, v] of vertices)
      this.vertex(point.x, point.y, u, v, 1, color);
  }

  disc(center: Point, radius: number, color: Rgba) {
    const steps = 32;
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      const b = ((index + 1) / steps) * Math.PI * 2;
      this.triangle(
        center,
        {
          x: center.x + Math.cos(a) * radius,
          y: center.y + Math.sin(a) * radius,
        },
        {
          x: center.x + Math.cos(b) * radius,
          y: center.y + Math.sin(b) * radius,
        },
        color,
      );
    }
  }

  circle(
    center: Point,
    radius: number,
    width: number,
    color: Rgba,
    from = 0,
    to = Math.PI * 2,
  ) {
    const steps = 32;
    const points = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = from + ((to - from) * index) / steps;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
    this.polyline(points, width, color);
  }

  view() {
    return this.data.subarray(0, this.count * 9);
  }
}

/** The scene's colors, read from the page's `--scene-*` tokens (light or dark). */
function palette(element: Element) {
  const style = getComputedStyle(element);
  const read = (name: string) =>
    channels(style.getPropertyValue(`--scene-${name}`));
  return {
    glow: read('glow'),
    glowSoft: read('glow-soft'),
    line: read('line'),
    surface: read('surface'),
    handoff: read('handoff'),
    handoffSoft: read('handoff-soft'),
  };
}

type Palette = ReturnType<typeof palette>;

const withAlpha = (color: [number, number, number], alpha: number): Rgba => [
  color[0],
  color[1],
  color[2],
  alpha,
];

/** One frame's shapes, back to front, as the still layers them. */
function draw(batch: Batch, frame: Frame, colors: Palette) {
  batch.count = 0;
  batch.sprite(
    frame.halo.center,
    frame.halo.radius * 1.15,
    withAlpha(colors.glowSoft, 0.6),
  );
  for (const mote of frame.motes)
    batch.sprite(mote, 3, withAlpha(colors.line, 1));
  for (const ring of frame.rings)
    batch.polyline(ring, 1, withAlpha(colors.line, 0.8), true);

  batch.dashed(frame.handoffPath, 1.5, 4, 5, withAlpha(colors.handoff, 1));
  const { center, radius } = frame.person;
  batch.sprite(
    center,
    radius * 2.6,
    withAlpha(colors.handoffSoft, frame.person.halo),
  );
  batch.disc(center, radius, withAlpha(colors.surface, 1));
  batch.circle(center, radius, 1.5, withAlpha(colors.handoff, 1));
  batch.circle(
    { x: center.x, y: center.y - radius * 0.18 },
    radius * 0.2,
    1.5,
    withAlpha(colors.handoff, 1),
  );
  batch.circle(
    { x: center.x, y: center.y + radius * 0.36 },
    radius * 0.36,
    1.5,
    withAlpha(colors.handoff, 1),
    Math.PI,
    Math.PI * 2,
  );

  if (frame.coreGlow > 0) {
    batch.sprite(
      frame.halo.center,
      frame.halo.radius * 0.75,
      withAlpha(colors.glow, 0.35 * frame.coreGlow),
    );
  }
  for (const face of frame.faces) {
    batch.triangle(
      ...face.points,
      withAlpha(colors.surface, 0.75 + face.shade * 0.25),
    );
  }
  for (const face of frame.faces) {
    const [a, b, c] = face.points;
    const edge = withAlpha(colors.glow, 1);
    const width = 1.25 + frame.coreGlow * 1.25;
    batch.line(a, b, width, edge);
    batch.line(b, c, width, edge);
    batch.line(c, a, width, edge);
  }

  const beam = frame.beam;
  batch.line(beam.from, beam.to, 1.25, withAlpha(colors.line, 1));
  if (beam.lit > 0) {
    batch.line(beam.from, beam.to, 2, withAlpha(colors.glow, beam.lit));
    batch.sprite(beam.to, 16, withAlpha(colors.glow, 0.5 * beam.lit));
  }
  const card = frame.card;
  const corners = [
    { x: card.x, y: card.y },
    { x: card.x + card.width, y: card.y },
    { x: card.x + card.width, y: card.y + card.height },
    { x: card.x, y: card.y + card.height },
  ];
  batch.quad(
    corners[0],
    corners[1],
    corners[2],
    corners[3],
    withAlpha(colors.surface, 1),
  );
  batch.polyline(corners, 1, withAlpha(colors.line, 1), true);
  const widths = [0.9, 0.75, 1, 0.6, 0.8];
  widths.forEach((share, line) => {
    const y = card.y + 16 + line * 13;
    const from = { x: card.x + 14, y };
    const to = { x: card.x + 14 + (card.width - 28) * share, y };
    const lit = line === card.litLine ? beam.lit : 0;
    batch.line(from, to, 4, withAlpha(colors.line, 0.6 * (1 - lit)));
    if (lit > 0) batch.line(from, to, 4, withAlpha(colors.glow, lit));
  });

  for (const question of frame.questions) {
    const color = question.handoff ? colors.handoff : colors.glow;
    batch.line(
      question.trail,
      question.center,
      1.25,
      withAlpha(colors.line, question.opacity),
    );
    batch.sprite(
      question.center,
      question.size * 1.1,
      withAlpha(color, 0.35 * question.opacity),
    );
    const half = question.size / 2;
    const { x, y } = question.center;
    batch.quad(
      { x, y: y - half },
      { x: x + half, y },
      { x, y: y + half },
      { x: x - half, y },
      withAlpha(color, question.opacity),
    );
  }
}

/** A question in flight: where it is in its life, in seconds. */
interface Flight {
  age: number;
  fate: 'answered' | 'handoff';
  delay: number;
  /** Seconds along the hand-off path, once it turned. */
  handedFor: number;
}

const QUESTION_TRAVEL = 3.6;
const SPAWN_EVERY = 1.4;
const MAX_QUESTIONS = 9;
const HANDOFF_TRAVEL = 1.4;

/** `standard` (0.2, 0, 0, 1), close enough for a 1.4 s path. */
const standard = (t: number) => 1 - (1 - t) ** 3;

/**
 * Starts the scene on `canvas`; returns the function that stops it.
 * Throws if WebGL 2 or its program can't be had (the loader keeps the still).
 */
export function startScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): () => void {
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    antialias: true,
    alpha: true,
  });
  if (!gl) throw new Error('WebGL 2 is unavailable');

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('No shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed');
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed');
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = 9 * 4;
  const attribute = (name: string, size: number, offset: number) => {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
  };
  attribute('a_position', 2, 0);
  attribute('a_uv', 2, 2);
  attribute('a_soft', 1, 4);
  attribute('a_color', 4, 5);
  const scaleAt = gl.getUniformLocation(program, 'u_scale');
  const offsetAt = gl.getUniformLocation(program, 'u_offset');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const colors = palette(canvas);
  const batch = new Batch();
  const random = seeded(SEED + 7);

  // The state starts at rest: the still. The resting questions set off one
  // after another, so they don't all arrive at once.
  const state: SceneState = restingState();
  let flights: Flight[] = state.questions.map((_, index) => ({
    age: 0,
    delay: index * 0.45,
    fate: random() < 0.8 ? 'answered' : 'handoff',
    handedFor: 0,
  }));
  let spawnIn = SPAWN_EVERY;
  /** Timers for the answer's light and the person's halo, in seconds since they started. */
  let answeredAt: number | null = null;
  let handedAt: number | null = null;

  const lean = { yaw: 0, pitch: 0 };
  const target = { yaw: 0, pitch: 0 };
  let leanTau = 0.08;
  let clock = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    // The view fits the box as the still's `xMidYMid meet` does.
    const fit = Math.min(width / VIEW.width, height / VIEW.height);
    const sx = (2 * fit) / width;
    const sy = (2 * fit) / height;
    gl.uniform2f(scaleAt, sx, sy);
    gl.uniform2f(
      offsetAt,
      -(VIEW.width * fit) / width,
      -(VIEW.height * fit) / height,
    );
  };
  resize();
  const resized = new ResizeObserver(resize);
  resized.observe(canvas);

  const onPointer = (event: PointerEvent) => {
    const box = options.hero.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 2 - 1;
    const y = ((event.clientY - box.top) / box.height) * 2 - 1;
    target.yaw = Math.max(-1, Math.min(1, x)) * 6 * DEG;
    target.pitch = Math.max(-1, Math.min(1, -y)) * 4 * DEG;
    leanTau = 0.08; // settles in about 250 ms
  };
  const onLeave = () => {
    target.yaw = 0;
    target.pitch = 0;
    leanTau = 0.2; // eases back over about 600 ms
  };
  options.hero.addEventListener('pointermove', onPointer);
  options.hero.addEventListener('pointerleave', onLeave);

  let visible = true;
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
  });
  seen.observe(options.hero);
  const onVisibility = () => {
    if (!document.hidden) schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const step = (dt: number) => {
    clock += dt;
    state.coreTurn += 6 * DEG * dt;

    for (const [index, flight] of flights.entries()) {
      const question = state.questions[index];
      flight.age += dt;
      const travel = Math.max(0, flight.age - flight.delay);
      if (question.handoff === null) {
        question.progress = Math.min(1, travel / QUESTION_TRAVEL);
        question.opacity =
          flight.delay === 0 ? Math.min(1, flight.age / 0.18) : 1;
        if (flight.fate === 'handoff' && question.progress >= 0.86)
          question.handoff = 0;
      } else {
        flight.handedFor += dt;
        question.handoff = standard(
          Math.min(1, flight.handedFor / HANDOFF_TRAVEL),
        );
      }
    }
    // Arrivals: answered at the core, handed off at the person.
    const keep: number[] = [];
    flights.forEach((flight, index) => {
      const question = state.questions[index];
      if (flight.fate === 'answered' && question.progress >= 1) {
        answeredAt = clock;
        state.litLine = Math.floor(random() * 5);
      } else if (question.handoff !== null && question.handoff >= 1) {
        handedAt = clock;
      } else {
        keep.push(index);
      }
    });
    state.questions = keep.map((index) => state.questions[index]);
    flights = keep.map((index) => flights[index]);

    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnIn += SPAWN_EVERY;
      if (state.questions.length < MAX_QUESTIONS) {
        state.questions.push({
          start: questionStart(random),
          size: 14 + Math.round(random() * 10),
          progress: 0,
          opacity: 0,
          handoff: null,
        });
        flights.push({
          age: 0,
          delay: 0,
          fate: random() < 0.8 ? 'answered' : 'handoff',
          handedFor: 0,
        });
      }
    }

    // The answer: edges glow 0 → 1 → 0 over 600 ms; the beam lights over
    // 180 ms, holds 900 ms and fades over 280 ms.
    if (answeredAt !== null) {
      const since = clock - answeredAt;
      state.coreGlow = since < 0.6 ? Math.sin((since / 0.6) * Math.PI) : 0;
      state.beam =
        since < 0.18
          ? since / 0.18
          : since < 1.08
            ? 1
            : Math.max(0, 1 - (since - 1.08) / 0.28);
    }
    // The person's halo: 0.45 → 0.9 → 0.45 over 800 ms.
    state.personHalo =
      handedAt !== null && clock - handedAt < 0.8
        ? 0.45 + 0.45 * Math.sin(((clock - handedAt) / 0.8) * Math.PI)
        : 0.45;
  };

  const camera = (): Camera => {
    const box = options.hero.getBoundingClientRect();
    const scrolled = Math.min(
      1,
      Math.max(0, -box.top / Math.max(box.height, 1)),
    );
    lean.yaw +=
      (target.yaw - lean.yaw) * (1 - Math.exp(-FRAME_MS / 1000 / leanTau));
    lean.pitch +=
      (target.pitch - lean.pitch) * (1 - Math.exp(-FRAME_MS / 1000 / leanTau));
    canvas.style.opacity = String(
      scrolled > 0.7 ? Math.max(0, 1 - (scrolled - 0.7) / 0.3) : 1,
    );
    return {
      yaw:
        REST_CAMERA.yaw +
        4 * DEG * Math.sin((clock / 12) * Math.PI * 2) +
        lean.yaw,
      pitch:
        REST_CAMERA.pitch +
        2 * DEG * Math.sin((clock / 9) * Math.PI * 2) +
        lean.pitch,
      dolly: 1 + 0.2 * scrolled,
    };
  };

  const render = (cam: Camera) => {
    const box = options.hero.getBoundingClientRect();
    const scrolled = Math.min(
      1,
      Math.max(0, -box.top / Math.max(box.height, 1)),
    );
    const turned = { ...state, coreTurn: state.coreTurn + 20 * DEG * scrolled };
    draw(batch, frameAt(turned, cam), colors);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER, batch.view(), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
  };

  // The first frame is the still, drawn before anything moves.
  render(REST_CAMERA);
  options.onReady();

  let frame = 0;
  let stopped = false;
  const pacer = new FramePacer();

  function schedule() {
    if (!stopped && !frame) {
      pacer.reset();
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number) {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const paced = pacer.tick(now);
    if (paced.slow) {
      stop();
      options.onSlow();
      return;
    }
    if (paced.render) {
      step(paced.dt);
      render(camera());
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    resized.disconnect();
    seen.disconnect();
    options.hero.removeEventListener('pointermove', onPointer);
    options.hero.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  schedule();
  return stop;
}
