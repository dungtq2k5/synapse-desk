/**
 * @jest-environment node
 */
import type {
  MessageResponseDto,
  TicketResponseDto,
  TicketStatusChangeResponseDto,
} from '@synapsedesk/api-client';
import { buildThread, lastNonAnswerId, type Entry } from './thread';

const ticket = {
  id: 't1',
  authorId: 'priya',
  createdAt: '2026-10-10T09:12:00Z',
} as TicketResponseDto;

const message = (over: Partial<MessageResponseDto>): MessageResponseDto =>
  ({
    id: 'm',
    senderId: 'priya',
    isAiGenerated: false,
    isInternalNote: false,
    answerStatus: null,
    createdAt: '2026-10-10T09:13:00Z',
    ...over,
  }) as MessageResponseDto;

const kinds = (entries: Entry[]) =>
  entries.map((entry) => `${entry.kind}:${entry.mine ? 'right' : 'left'}`);

describe('buildThread', () => {
  const base = {
    ticket,
    history: [] as TicketStatusChangeResponseDto[],
    pending: [],
    answers: [],
    notices: [],
  };

  it("puts the description first, and each entry on its author's side", () => {
    const messages = [
      message({
        id: 'ai',
        senderId: null,
        isAiGenerated: true,
        createdAt: '2026-10-10T09:12:30Z',
      }),
      message({
        id: 'agent',
        senderId: 'maya',
        createdAt: '2026-10-10T09:20:00Z',
      }),
      message({
        id: 'again',
        senderId: 'priya',
        createdAt: '2026-10-10T09:14:00Z',
      }),
    ];

    expect(
      kinds(buildThread({ ...base, messages, viewerId: 'priya' })),
    ).toEqual([
      'description:right',
      'message:left',
      'message:right',
      'message:left',
    ]);
    // The agent's view of the same thread: the requester is on the left.
    expect(kinds(buildThread({ ...base, messages, viewerId: 'maya' }))).toEqual(
      ['description:left', 'message:left', 'message:left', 'message:right'],
    );
  });

  it('shows an escalation from the history as a notice, in time order', () => {
    const entries = buildThread({
      ...base,
      viewerId: 'priya',
      messages: [message({ id: 'late', createdAt: '2026-10-10T09:30:00Z' })],
      history: [
        { id: 'h1', toStatus: 'OPEN', changedAt: '2026-10-10T09:13:00Z' },
        { id: 'h2', toStatus: 'ESCALATED', changedAt: '2026-10-10T09:15:00Z' },
      ] as TicketStatusChangeResponseDto[],
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      'description:t1',
      'notice:h2',
      'late',
    ]);
  });

  it('a pending reply and a finished answer give way to their stored message', () => {
    const pending = [
      {
        clientMessageId: 'c1',
        content: 'hi',
        isInternalNote: false,
        createdAt: '2026-10-10T09:13:00Z',
        state: 'sending' as const,
        messageId: 'stored',
      },
      {
        clientMessageId: 'c2',
        content: 'lost',
        isInternalNote: false,
        createdAt: '2026-10-10T09:14:00Z',
        state: 'failed' as const,
      },
    ];
    const answers = [
      {
        streamId: 's1',
        text: 'All',
        startedAt: '2026-10-10T09:13:01Z',
        state: 'done' as const,
        messageId: 'answer',
      },
      {
        streamId: 's2',
        text: 'Half',
        startedAt: '2026-10-10T09:15:00Z',
        state: 'stopped' as const,
      },
      // AT_CAP: done with no message; its notices take its place.
      {
        streamId: 's3',
        text: '',
        startedAt: '2026-10-10T09:16:00Z',
        state: 'done' as const,
      },
    ];

    const before = buildThread({
      ...base,
      viewerId: 'priya',
      messages: [],
      pending,
      answers,
    });
    expect(before.map((entry) => entry.id)).toEqual([
      'description:t1',
      'pending:c1',
      'answer:s1',
      'pending:c2',
      'answer:s2',
    ]);

    const after = buildThread({
      ...base,
      viewerId: 'priya',
      pending,
      answers,
      messages: [
        message({ id: 'stored', createdAt: '2026-10-10T09:13:00Z' }),
        message({
          id: 'answer',
          senderId: null,
          isAiGenerated: true,
          createdAt: '2026-10-10T09:13:05Z',
        }),
      ],
    });
    expect(after.map((entry) => entry.id)).toEqual([
      'description:t1',
      'stored',
      'answer',
      'pending:c2',
      'answer:s2',
    ]);
  });
});

describe('lastNonAnswerId', () => {
  it('finds the latest non-answer: a refusal, a miss, or a stream that failed or stopped', () => {
    const entries = buildThread({
      ticket,
      viewerId: 'priya',
      history: [],
      pending: [],
      notices: [],
      answers: [],
      messages: [
        message({
          id: 'miss',
          senderId: null,
          isAiGenerated: true,
          answerStatus: 'DOC_MISSING',
          createdAt: '2026-10-10T09:13:00Z',
        }),
        message({
          id: 'ok',
          senderId: null,
          isAiGenerated: true,
          answerStatus: 'DOC_ANSWER',
          createdAt: '2026-10-10T09:14:00Z',
        }),
      ],
    });
    expect(lastNonAnswerId(entries)).toBe('miss');
    expect(lastNonAnswerId(entries.slice(0, 1))).toBeNull();
  });
});
