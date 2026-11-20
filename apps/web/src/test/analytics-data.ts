import type {
  AgentAnalyticsResponseDto,
  AiUsageResponseDto,
  AiUsageSliceResponseDto,
  DeflectionResponseDto,
  DocumentAnalyticsResponseDto,
  FeedbackResponseDto,
  KnowledgeGapsResponseDto,
  OverviewResponseDto,
  ResponseTimesResponseDto,
  SatisfactionResponseDto,
  VolumeResponseDto,
} from '@synapsedesk/api-client';
import {
  CHEAP_MODEL,
  EMBEDDING_MODEL,
  GENERATION_MODEL_BY_TIER,
} from '@synapsedesk/contracts';

const QUALITY = GENERATION_MODEL_BY_TIER.QUALITY;

/**
 * Analytics as design 10 draws it: Northwind Health on Pro, the last 30 days
 * (20 Sept – 19 Oct 2026), data through 19 Oct. The daily values are seeded,
 * so every run draws the same lines; the totals are the handoff's sample.
 */

export const FROM = '2026-09-20';
export const TO = '2026-10-19';
export const RANGE = `from=${FROM}&to=${TO}`;
export const COMPUTED = '2026-10-20T02:10:00.000Z';

/** The 30 days of the range. */
export const DAYS = Array.from({ length: 30 }, (_, index) => {
  const day = new Date(`${FROM}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + index);
  return day.toISOString().slice(0, 10);
});

/** A seeded stream of numbers in [0, 1), the same every run. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** `count` whole numbers summing to `total`, weekends quieter. */
function spread(total: number, seed: number): number[] {
  const random = seeded(seed);
  const weights = DAYS.map((day) => {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    const quiet = weekday === 0 || weekday === 6;
    return (quiet ? 0.35 : 1) * (0.7 + random() * 0.6);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const values = weights.map((weight) => Math.floor((weight / sum) * total));
  let left = total - values.reduce((a, b) => a + b, 0);
  for (let index = 0; left > 0; index = (index + 7) % values.length, left--) {
    values[index] += 1;
  }
  return values;
}

const rate = (numerator: number, denominator: number) => ({
  rate: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
});
const mean = (value: number | null, count: number) => ({ mean: value, count });

const created = spread(415, 7);
const resolved = spread(397, 11);
const escalated = spread(63, 13);

export const OVERVIEW: OverviewResponseDto = {
  ticketsCreated: 415,
  ticketsResolved: 397,
  ticketsEscalated: 63,
  openTickets: 47,
  deflection: rate(265, 427),
  csat: rate(170, 200),
  humanFirstResponseSeconds: mean(8460, 186),
  aiFirstResponseSeconds: mean(8, 409),
  resolutionSeconds: mean(97_200, 397),
  openTicketMedianAgeSeconds: 108_000,
  computedAt: COMPUTED,
  dataThrough: TO,
};

/** The 30 days before: what the change lines compare against. */
export const PREVIOUS: OverviewResponseDto = {
  ...OVERVIEW,
  ticketsCreated: 392,
  ticketsResolved: 382,
  deflection: rate(248, 420),
  csat: rate(172, 200),
  humanFirstResponseSeconds: mean(9180, 170),
  aiFirstResponseSeconds: mean(8, 380),
  resolutionSeconds: mean(104_400, 382),
};

export const VOLUME: VolumeResponseDto = {
  points: DAYS.map((day, index) => ({
    day,
    created: created[index],
    resolved: resolved[index],
    escalated: escalated[index],
  })),
  byStatus: [
    { key: 'NEW', count: 12 },
    { key: 'OPEN', count: 21 },
    { key: 'PENDING_AGENT', count: 9 },
    { key: 'ESCALATED', count: 5 },
    { key: 'RESOLVED', count: 296 },
    { key: 'CLOSED', count: 72 },
  ],
  byPriority: [
    { key: 'LOW', count: 118 },
    { key: 'MEDIUM', count: 201 },
    { key: 'HIGH', count: 74 },
    { key: 'URGENT', count: 22 },
  ],
  bySource: [
    { key: 'WEB', count: 168 },
    { key: 'EMAIL', count: 121 },
    { key: 'CHAT', count: 98 },
    { key: 'API', count: 28 },
  ],
  dataThrough: TO,
};

const chats = spread(427, 17);
const deflected = chats.map((count, index) =>
  Math.round(count * (0.53 + seeded(19 + index)() * 0.19)),
);

export const DEFLECTION: DeflectionResponseDto = {
  points: DAYS.map((day, index) => ({
    day,
    deflection: rate(deflected[index], chats[index]),
    chatConversations: chats[index],
    chatResolvedWithoutEscalation: deflected[index],
  })),
  total: rate(265, 427),
  dataThrough: TO,
};

const ratings = spread(200, 23);

export const SATISFACTION: SatisfactionResponseDto = {
  points: DAYS.map((day, index) => {
    const random = seeded(29 + index);
    const total = ratings[index];
    return {
      day,
      csat: rate(Math.round(total * (0.8 + random() * 0.1)), total),
      citationAccuracy: rate(
        Math.round(total * (0.87 + random() * 0.08)),
        total,
      ),
    };
  }),
  csatTotal: rate(170, 200),
  citationAccuracyTotal: rate(182, 200),
  dataThrough: TO,
};

export const RESPONSE_TIMES: ResponseTimesResponseDto = {
  points: DAYS.map((day, index) => {
    const random = seeded(31 + index);
    return {
      day,
      humanFirstResponseSeconds: mean(3600 * (1.5 + random() * 3), 6),
      aiFirstResponseSeconds: mean(5 + random() * 7, 14),
      resolutionSeconds: mean(3600 * (20 + random() * 12), resolved[index]),
    };
  }),
  humanTotal: mean(8460, 186),
  aiTotal: mean(8, 409),
  resolutionTotal: mean(97_200, 397),
  dataThrough: TO,
};

const agent = (
  id: number,
  fullName: string,
  assigned: number,
  done: number,
  messages: number,
  hours: number,
  drafts: [number, number] | null,
) => ({
  agentId: `aaaaaaaa-0000-4000-8000-00000000000${id}`,
  fullName,
  assigned,
  resolved: done,
  messagesSent: messages,
  resolutionSeconds: mean(hours * 3600, done),
  draftAcceptance: drafts ? rate(drafts[0], drafts[1]) : null,
});

export const AGENTS: AgentAnalyticsResponseDto = {
  items: [
    agent(1, 'Alex Rivera', 41, 38, 212, 26, [52, 76]),
    agent(2, 'Dana Novak', 12, 11, 54, 22 + 40 / 60, null),
    agent(3, 'Jordan Lee', 57, 55, 301, 25, [98, 132]),
    agent(4, 'Lee Wong', 38, 36, 190, 28, [61, 87]),
    agent(5, 'Maya Chen', 9, 9, 33, 19 + 5 / 60, [4, 8]),
    agent(6, 'Sam Okafor', 23, 21, 118, 30, [35, 43]),
  ],
  dataThrough: TO,
  unavailable: [],
};

export const GAPS: KnowledgeGapsResponseDto = {
  emptyRetrievals: 37,
  answeringGenerations: 412,
  emptyRetrievalRate: rate(37, 412),
  attachmentGroundedRate: rate(16, 412),
  attachmentEmptyRetrievals: 3,
  flags: [
    {
      documentId: 'dddddddd-0000-4000-8000-000000000001',
      documentTitle: 'Printer setup (3rd floor)',
      flagType: 'UNRETRIEVED',
      detail:
        'No question has ever retrieved this document. It may be mis-titled, or it may not be needed.',
    },
    {
      documentId: 'dddddddd-0000-4000-8000-000000000002',
      documentTitle: 'IT security basics',
      flagType: 'UNCITED',
      detail: 'Retrieved 19 times and never cited.',
    },
  ],
  dataThrough: TO,
  unavailable: [],
};

const usage = (
  id: number,
  title: string,
  citations: number,
  retrievals: number,
  chunks: number,
) => ({
  documentId: `dddddddd-0000-4000-8000-00000000001${id}`,
  title,
  citationCount: citations,
  retrievalCount: retrievals,
  chunkCount: chunks,
});

export const DOCUMENTS: DocumentAnalyticsResponseDto = {
  mostCited: [
    usage(1, 'Expense policy 2026', 64, 210, 30),
    usage(2, 'VPN setup guide', 51, 138, 12),
    usage(3, 'Payroll FAQ', 47, 160, 18),
    usage(4, 'Onboarding checklist', 33, 97, 9),
    usage(5, 'Leave and holidays', 29, 120, 22),
  ],
  neverRetrieved: [
    usage(6, 'Printer setup (3rd floor)', 0, 0, 12),
    usage(7, 'Old travel policy (2023)', 0, 0, 31),
    usage(8, 'Parking permits', 0, 0, 6),
  ],
  retrievedNeverCited: [
    usage(9, 'Benefits overview', 0, 44, 58),
    usage(0, 'IT security basics', 0, 19, 40),
  ],
  citationAccuracy: rate(182, 200),
  dataThrough: TO,
  unavailable: [],
};

const slice = (
  purpose: string,
  modelName: string,
  generations: number,
  millions: number,
  cents: number,
  seconds: number,
  failed: number,
): AiUsageSliceResponseDto => ({
  purpose,
  modelName,
  generations,
  promptTokens: Math.round(millions * 700_000),
  completionTokens: Math.round(millions * 300_000),
  costMicros: cents * 10_000,
  latencyMs: mean(seconds * 1000, generations),
  failureRate: rate(failed, generations),
});

const spend = spread(740, 37);

export const AI_USAGE: AiUsageResponseDto = {
  points: DAYS.map((day, index) => ({
    day,
    generations: Math.round(4812 / 30),
    costMicros: spend[index] * 10_000,
  })),
  byPurpose: [
    slice('CHAT_ANSWER', QUALITY, 412, 1.92, 310, 3.4, 2),
    slice('DRAFT', QUALITY, 480, 1.31, 205, 4.1, 3),
    slice('REVIEW', QUALITY, 612, 0.62, 86, 2.2, 1),
    slice('SUMMARY', QUALITY, 310, 0.41, 52, 2.8, 0),
    slice('SUGGESTIONS', CHEAP_MODEL, 290, 0.88, 31, 1.1, 1),
    slice('CLASSIFY', CHEAP_MODEL, 415, 0.63, 22, 0.6, 0),
    slice('INJECTION_CLASSIFY', CHEAP_MODEL, 892, 0.41, 14, 0.4, 4),
    slice('GREETING_CLASSIFY', CHEAP_MODEL, 427, 0.26, 9, 0.4, 0),
    slice('REFORMULATION', CHEAP_MODEL, 384, 0.21, 7, 0.5, 0),
    slice('EMBEDDING', EMBEDDING_MODEL, 590, 1.18, 4, 0.2, 0),
  ],
  byModel: [
    slice('', QUALITY, 1814, 4.26, 653, 3.2, 6),
    slice('', CHEAP_MODEL, 2408, 2.39, 83, 0.6, 5),
    slice('', EMBEDDING_MODEL, 590, 1.18, 4, 0.2, 0),
  ],
  totalCostMicros: 7_400_000,
  totalGenerations: 4812,
  monthlyBudgetMicros: 10_000_000,
  aiModelTier: 'QUALITY',
  draftAcceptance: rate(340, 480),
  emptyRetrievalRate: rate(37, 412),
  computedAt: COMPUTED,
  dataThrough: TO,
  cycleSpentMicros: 4_590_000,
  planName: 'Pro',
  cycleResetsAt: '2026-11-01T00:00:00.000Z',
};

const COMMENTS: [1 | -1, string | null, boolean | null][] = [
  [1, 'Clear answer, the VPN steps worked first time.', true],
  [-1, 'It cited last year’s expense policy.', false],
  [1, null, true],
  [-1, 'Didn’t answer the question about carry-over days.', null],
  [1, 'Quick and right.', true],
  [-1, null, false],
];

/** Ratings, newest first: a page of 20 of 214. */
export const FEEDBACK: FeedbackResponseDto[] = Array.from(
  { length: 20 },
  (_, index) => {
    const [rating, text, accurate] = COMMENTS[index % COMMENTS.length];
    const at = new Date(
      Date.UTC(2026, 9, 19 - index, 9 + (index % 8), 42 - index),
    );
    return {
      id: `ffffffff-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
      ticketMessageId: `eeeeeeee-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
      userId: 'cccccccc-0000-4000-8000-000000000001',
      organizationId: 'org',
      rating,
      feedbackText: text,
      citationAccurate: accurate,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      ticketId: `bbbbbbbb-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
      ticketNumber: 1042 - index * 3,
    };
  },
);

export const FEEDBACK_PAGE = {
  items: FEEDBACK,
  meta: {
    totalItems: 214,
    itemCount: 20,
    itemsPerPage: 20,
    totalPages: 11,
    currentPage: 1,
  },
};

/** The server's bucket for a day: its Monday, or the 1st of its month. */
export function bucket(day: string, by: string): string {
  if (by === 'MONTH') return `${day.slice(0, 8)}01`;
  if (by !== 'WEEK') return day;
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

type Point = { day: string };

/** Daily points summed into buckets, as the server answers a granularity. */
export function grouped<T extends Point>(
  points: T[],
  by: string,
  add: (a: T, b: T) => T,
): T[] {
  const buckets = new Map<string, T>();
  for (const point of points) {
    const key = bucket(point.day, by);
    const previous = buckets.get(key);
    buckets.set(
      key,
      previous ? { ...add(previous, point), day: key } : { ...point, day: key },
    );
  }
  return [...buckets.values()];
}

const addRate = (
  a: { numerator: number; denominator: number },
  b: { numerator: number; denominator: number },
) => rate(a.numerator + b.numerator, a.denominator + b.denominator);
const addMean = (
  a: { mean: number | null; count: number },
  b: { mean: number | null; count: number },
) => {
  const count = a.count + b.count;
  return mean(
    count === 0
      ? null
      : ((a.mean ?? 0) * a.count + (b.mean ?? 0) * b.count) / count,
    count,
  );
};

/** The four time series at a granularity. */
export function series(by: string) {
  return {
    volume: {
      ...VOLUME,
      points: grouped(VOLUME.points, by, (a, b) => ({
        day: a.day,
        created: a.created + b.created,
        resolved: a.resolved + b.resolved,
        escalated: a.escalated + b.escalated,
      })),
    },
    deflection: {
      ...DEFLECTION,
      points: grouped(DEFLECTION.points, by, (a, b) => ({
        day: a.day,
        deflection: addRate(a.deflection, b.deflection),
        chatConversations: a.chatConversations + b.chatConversations,
        chatResolvedWithoutEscalation:
          a.chatResolvedWithoutEscalation + b.chatResolvedWithoutEscalation,
      })),
    },
    satisfaction: {
      ...SATISFACTION,
      points: grouped(SATISFACTION.points, by, (a, b) => ({
        day: a.day,
        csat: addRate(a.csat, b.csat),
        citationAccuracy: addRate(a.citationAccuracy, b.citationAccuracy),
      })),
    },
    responseTimes: {
      ...RESPONSE_TIMES,
      points: grouped(RESPONSE_TIMES.points, by, (a, b) => ({
        day: a.day,
        humanFirstResponseSeconds: addMean(
          a.humanFirstResponseSeconds,
          b.humanFirstResponseSeconds,
        ),
        aiFirstResponseSeconds: addMean(
          a.aiFirstResponseSeconds,
          b.aiFirstResponseSeconds,
        ),
        resolutionSeconds: addMean(a.resolutionSeconds, b.resolutionSeconds),
      })),
    },
  };
}

/** A computed organization with nothing in it yet. */
export const EMPTY = {
  overview: {
    ...OVERVIEW,
    ticketsCreated: 0,
    ticketsResolved: 0,
    ticketsEscalated: 0,
    openTickets: 0,
    deflection: rate(0, 0),
    csat: rate(0, 0),
    humanFirstResponseSeconds: mean(null, 0),
    aiFirstResponseSeconds: mean(null, 0),
    resolutionSeconds: mean(null, 0),
    openTicketMedianAgeSeconds: null,
  } satisfies OverviewResponseDto,
  volume: {
    ...VOLUME,
    points: [],
    byStatus: [],
    byPriority: [],
    bySource: [],
  } satisfies VolumeResponseDto,
  deflection: {
    ...DEFLECTION,
    points: [],
    total: rate(0, 0),
  } satisfies DeflectionResponseDto,
  satisfaction: {
    ...SATISFACTION,
    points: [],
    csatTotal: rate(0, 0),
    citationAccuracyTotal: rate(0, 0),
  } satisfies SatisfactionResponseDto,
  responseTimes: {
    ...RESPONSE_TIMES,
    points: [],
    humanTotal: mean(null, 0),
    aiTotal: mean(null, 0),
    resolutionTotal: mean(null, 0),
  } satisfies ResponseTimesResponseDto,
  gaps: {
    ...GAPS,
    emptyRetrievals: 0,
    answeringGenerations: 0,
    emptyRetrievalRate: rate(0, 0),
    attachmentGroundedRate: rate(0, 0),
    flags: [],
  } satisfies KnowledgeGapsResponseDto,
  documents: {
    mostCited: [],
    neverRetrieved: [],
    retrievedNeverCited: [],
    citationAccuracy: null,
    dataThrough: TO,
    unavailable: [],
  } satisfies DocumentAnalyticsResponseDto,
};
