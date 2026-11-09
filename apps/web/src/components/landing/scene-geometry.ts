/**
 * The hero scene's geometry: one 3D world, one camera, and the frame it makes
 * as flat screen-space shapes in an 800 × 640 view.
 *
 * Both renderers draw from {@link frameAt}: the server's still image
 * (`scene-still.tsx`, an inline SVG) at the resting state, and the live
 * canvas (`scene.ts`, WebGL 2) every frame. So the still and the canvas's
 * first frame are the same picture by construction.
 *
 * The world: a low-poly core (an icosahedron, 20 faces) at the origin, two
 * orbit rings in a tilted plane, drifting motes, question shapes travelling in
 * to the core, a passage card the beam lights, and a person node at the end of
 * a dashed hand-off path. A perspective camera (35° field of view) faces the
 * core. Everything random comes from a fixed seed.
 *
 * @example const frame = frameAt(restingState(), REST_CAMERA)
 */

/** The view the scene is drawn in; renderers scale it to their box. */
export const VIEW = { width: 800, height: 640 } as const;

const CENTER = { x: 390, y: 320 };
const FOV_DEGREES = 35;
/** Focal length in view pixels: half the view's height over tan(fov / 2). */
const FOCAL = VIEW.height / 2 / Math.tan(((FOV_DEGREES / 2) * Math.PI) / 180);
const DISTANCE = 10;
const CORE_RADIUS = 1.25;
const RING_TILT = (33 * Math.PI) / 180;
const RINGS = [2.76, 3.65];
/** The core's resting attitude, so it reads as a solid rather than a flat badge. */
const CORE_YAW = 0.5;
const CORE_TILT = 0.42;
const RING_DROP = -0.1;

/** Where the camera sits: yaw and pitch around the core, and how far back. */
export interface Camera {
  yaw: number;
  pitch: number;
  /** 1 at rest; 1.2 is 20% further back. */
  dolly: number;
}

export const REST_CAMERA: Camera = { yaw: 0, pitch: 0, dolly: 1 };

type Vec3 = readonly [number, number, number];

/** One question's state: where it started, how far in, and its fate. */
export interface QuestionState {
  start: Vec3;
  /** View pixels at rest. */
  size: number;
  /** 0 at its start, 1 at the core. */
  progress: number;
  /** 0 to 1, its fade-in. */
  opacity: number;
  /** On its way to a person, and how far along the hand-off path (0 to 1). */
  handoff: number | null;
}

/** Everything that changes over time. */
export interface SceneState {
  /** The core's own turn, in radians. */
  coreTurn: number;
  questions: QuestionState[];
  /** 0 to 1: the core's edges glowing as a question is answered. */
  coreGlow: number;
  /** 0 to 1: the beam and one line of the passage card lit. */
  beam: number;
  /** Which line of the card is lit. */
  litLine: number;
  /** 0.45 to 0.9: the person's halo. */
  personHalo: number;
}

/** A small seeded generator (mulberry32), so the layout is the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 1201;

/**
 * A point outside the outer ring, near the rings' plane. With a `slot` of
 * `slots`, the angle is spread evenly around (with some jitter), as the
 * resting frame draws them; without, anywhere.
 */
export function questionStart(
  random: () => number,
  slot?: number,
  slots = 9,
): Vec3 {
  const angle =
    slot === undefined
      ? random() * Math.PI * 2
      : ((slot + 0.2 + random() * 0.6) / slots) * Math.PI * 2;
  // An ellipse around the core in the view's plane, so no question starts in
  // front of the core or the card; a little depth for parallax.
  const reach = 1 + random() * 0.15;
  return [
    Math.cos(angle) * 3.05 * reach,
    Math.sin(angle) * 2.15 * reach,
    (random() - 0.5) * 1.2,
  ];
}

const MOTES: Vec3[] = (() => {
  const random = seeded(SEED + 1);
  return Array.from({ length: 12 }, () => {
    const angle = random() * Math.PI * 2;
    const radius = 2.2 + random() * 3.6;
    return [
      Math.cos(angle) * radius,
      (random() - 0.5) * 6,
      Math.sin(angle) * radius * 0.6,
    ] as Vec3;
  });
})();

/** The resting state: nine questions at their seeded starts, nothing lit. */
export function restingState(): SceneState {
  const random = seeded(SEED);
  return {
    coreTurn: 0,
    questions: Array.from({ length: 9 }, (_, slot) => ({
      start: questionStart(random, slot),
      size: 14 + Math.round(random() * 10),
      progress: 0,
      opacity: 1,
      handoff: null,
    })),
    coreGlow: 0,
    beam: 0,
    litLine: 2,
    personHalo: 0.45,
  };
}

// ------------------------------------------------------------- the core

const PHI = (1 + Math.sqrt(5)) / 2;
const ICOSA_VERTICES: Vec3[] = (
  [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI],
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ] as const
).map(([x, y, z]) => {
  const length = Math.hypot(x, y, z);
  return [
    (x / length) * CORE_RADIUS,
    (y / length) * CORE_RADIUS,
    (z / length) * CORE_RADIUS,
  ] as Vec3;
});

const ICOSA_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

// ------------------------------------------------------------ projection

const rotateY = ([x, y, z]: Vec3, angle: number): Vec3 => [
  x * Math.cos(angle) + z * Math.sin(angle),
  y,
  -x * Math.sin(angle) + z * Math.cos(angle),
];

const rotateX = ([x, y, z]: Vec3, angle: number): Vec3 => [
  x,
  y * Math.cos(angle) - z * Math.sin(angle),
  y * Math.sin(angle) + z * Math.cos(angle),
];

/** A world point on screen: view pixels, the perspective scale, and its depth. */
export interface Projected {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

/** The camera orbits the core: the world turns the other way, then sits `DISTANCE × dolly` away. */
export function project(point: Vec3, camera: Camera): Projected {
  const turned = rotateX(rotateY(point, -camera.yaw), -camera.pitch);
  const depth = DISTANCE * camera.dolly - turned[2];
  const scale = FOCAL / depth;
  return {
    x: CENTER.x + turned[0] * scale,
    y: CENTER.y - turned[1] * scale,
    scale: scale / (FOCAL / DISTANCE),
    depth,
  };
}

// ------------------------------------------------------------- the frame

export type Point = { x: number; y: number };

/** What one frame draws, back to front, in view pixels. */
export interface Frame {
  halo: { center: Point; radius: number };
  motes: Point[];
  rings: Point[][];
  /** Front-facing faces of the core, back to front, with their shade (0 to 1). */
  faces: { points: [Point, Point, Point]; shade: number }[];
  coreGlow: number;
  beam: { from: Point; to: Point; lit: number };
  card: {
    x: number;
    y: number;
    width: number;
    height: number;
    litLine: number;
  };
  handoffPath: Point[];
  person: { center: Point; radius: number; halo: number };
  questions: {
    center: Point;
    size: number;
    opacity: number;
    trail: Point;
    handoff: boolean;
  }[];
}

const CARD_ANCHOR: Vec3 = [2.46, 1.05, 0.4];
const PERSON_ANCHOR: Vec3 = [2.4, -1.82, 0.6];
const CARD_SIZE = { width: 160, height: 88 };
const PERSON_RADIUS = 27;

/** A ring of the given radius in the tilted plane, as a closed polyline. */
function ring(radius: number, camera: Camera): Point[] {
  return Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    const flat: Vec3 = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
    const tilted = rotateX(flat, RING_TILT);
    const { x, y } = project(
      [tilted[0], tilted[1] + RING_DROP, tilted[2]],
      camera,
    );
    return { x, y };
  });
}

/** A gentle curve from `from` to `to`, bowed below the straight line. */
function curve(from: Point, to: Point, bow: number, steps = 24): Point[] {
  const control = {
    x: (from.x + to.x) / 2 - bow * 0.3,
    y: (from.y + to.y) / 2 + bow,
  };
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
  });
}

/** Where a question is in the world: its start, eased in toward the core along a slight curve. */
function questionAt(question: QuestionState): Vec3 {
  const t = question.progress;
  const eased = t * t * t; // ease-in, close to (0.4, 0, 1, 1)
  const [x, y, z] = question.start;
  const remain = 1 - eased;
  const sway = Math.sin(eased * Math.PI) * 0.35;
  return [
    x * remain + z * sway * 0.2,
    y * remain + sway * 0.25,
    z * remain - x * sway * 0.2,
  ];
}

/** The frame a state makes through a camera. */
export function frameAt(state: SceneState, camera: Camera): Frame {
  const core = project([0, 0, 0], camera);
  const card = project(CARD_ANCHOR, camera);
  const person = project(PERSON_ANCHOR, camera);

  const faces = ICOSA_FACES.map((face) => {
    const world = face.map((index) =>
      rotateX(
        rotateY(ICOSA_VERTICES[index], state.coreTurn + CORE_YAW),
        CORE_TILT,
      ),
    ) as [Vec3, Vec3, Vec3];
    const points = world.map((vertex) => project(vertex, camera)) as [
      Projected,
      Projected,
      Projected,
    ];
    // Facing the camera when the screen winding is counter-clockwise.
    const [a, b, c] = points;
    const facing = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
    const depth = (a.depth + b.depth + c.depth) / 3;
    const normal = world.reduce(
      (sum, vertex) => sum + vertex[1] * 0.5 + vertex[0] * 0.3,
      0,
    );
    return {
      points: points.map(({ x, y }) => ({ x, y })) as [Point, Point, Point],
      shade: Math.min(1, Math.max(0, 0.55 + normal / (CORE_RADIUS * 3))),
      depth,
      facing,
    };
  })
    .filter((face) => face.facing)
    .sort((left, right) => right.depth - left.depth)
    .map(({ points, shade }) => ({ points, shade }));

  const cardBox = {
    width: CARD_SIZE.width * card.scale,
    height: CARD_SIZE.height * card.scale,
  };
  const cardEdge = {
    x: card.x - cardBox.width / 2,
    y: card.y + cardBox.height * 0.1,
  };
  const coreEdge = {
    x: core.x + 115 * core.scale,
    y: core.y - 52 * core.scale,
  };
  const handoffFrom = {
    x: core.x + 70 * core.scale,
    y: core.y + 65 * core.scale,
  };
  const handoffTo = {
    x: person.x - PERSON_RADIUS * person.scale,
    y: person.y - 2 * person.scale,
  };
  const handoffPath = curve(handoffFrom, handoffTo, 34 * person.scale);

  return {
    halo: { center: { x: core.x, y: core.y }, radius: 210 * core.scale },
    motes: MOTES.map((mote) => {
      const { x, y } = project(mote, camera);
      return { x, y };
    }),
    rings: RINGS.map((radius) => ring(radius, camera)),
    faces,
    coreGlow: state.coreGlow,
    beam: { from: coreEdge, to: cardEdge, lit: state.beam },
    card: {
      x: card.x - cardBox.width / 2,
      y: card.y - cardBox.height / 2,
      width: cardBox.width,
      height: cardBox.height,
      litLine: state.litLine,
    },
    handoffPath,
    person: {
      center: { x: person.x, y: person.y },
      radius: PERSON_RADIUS * person.scale,
      halo: state.personHalo,
    },
    questions: state.questions.map((question) => {
      if (question.handoff !== null) {
        const along =
          handoffPath[Math.round(question.handoff * (handoffPath.length - 1))];
        return {
          center: along,
          size: question.size * 0.8,
          opacity: question.opacity,
          trail: along,
          handoff: true,
        };
      }
      const here = project(questionAt(question), camera);
      const behind = project(
        questionAt({
          ...question,
          progress: Math.max(0, question.progress - 0.08),
        }),
        camera,
      );
      // At rest the trail points back out, the way it came, up to 40 px.
      const away = {
        x: here.x + (here.x - core.x) * 0.08,
        y: here.y + (here.y - core.y) * 0.08,
      };
      const from = question.progress > 0 ? behind : away;
      const length = Math.hypot(from.x - here.x, from.y - here.y);
      const cap = Math.min(1, 40 / Math.max(length, 1));
      return {
        center: { x: here.x, y: here.y },
        size: question.size * here.scale,
        opacity: question.opacity,
        trail: {
          x: here.x + (from.x - here.x) * cap,
          y: here.y + (from.y - here.y) * cap,
        },
        handoff: false,
      };
    }),
  };
}
