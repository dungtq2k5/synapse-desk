import type {
  MessageResponseDto,
  TicketResponseDto,
  TicketStatusChangeResponseDto,
} from '@synapsedesk/api-client';

/** A reply of mine, sent from this tab and not yet in the stored thread. */
export type PendingSend = {
  clientMessageId: string;
  content: string;
  isInternalNote: boolean;
  createdAt: string;
  state: 'sending' | 'failed';
  /** Set once the server acknowledged it: the stored message's id. */
  messageId?: string;
};

/** An AI answer this tab asked for, as it streams in. Never stored as such. */
export type LiveAnswer = {
  streamId: string;
  text: string;
  startedAt: string;
  state: 'streaming' | 'failed' | 'stopped' | 'done';
  /** Set when done: the stored message that replaces this entry. */
  messageId?: string;
};

/** Something that happened TO the ticket, shown centred, with no author. */
export type Notice = {
  kind: 'escalated' | 'ai-unavailable';
  at: string;
  id: string;
};

export type Entry =
  | { kind: 'description'; id: string; at: string; mine: boolean }
  | {
      kind: 'message';
      id: string;
      at: string;
      mine: boolean;
      message: MessageResponseDto;
    }
  | {
      kind: 'pending';
      id: string;
      at: string;
      mine: true;
      pending: PendingSend;
    }
  | { kind: 'answer'; id: string; at: string; mine: false; answer: LiveAnswer }
  | { kind: 'notice'; id: string; at: string; mine: false; notice: Notice };

/**
 * The thread in time order: the ticket's description first (the requester's
 * opening entry), then the stored messages, the escalations from the status
 * history, and what this tab has live: replies still sending or failed,
 * answers streaming, and the AI-unavailable notice (`AT_CAP` is never
 * stored).
 *
 * A pending reply or a finished answer gives way to its stored message as
 * soon as the thread has it, so nothing shows twice.
 *
 * @example buildThread({ ticket, messages, history, viewerId, pending: [], answers: [], notices: [] })
 */
export function buildThread({
  ticket,
  messages,
  history,
  viewerId,
  pending,
  answers,
  notices,
}: {
  ticket: TicketResponseDto;
  messages: MessageResponseDto[];
  history: TicketStatusChangeResponseDto[];
  viewerId: string | null;
  pending: PendingSend[];
  answers: LiveAnswer[];
  notices: Notice[];
}): Entry[] {
  const stored = new Set(messages.map((message) => message.id));

  const entries: Entry[] = [
    {
      kind: 'description',
      id: `description:${ticket.id}`,
      at: ticket.createdAt,
      mine: ticket.authorId === viewerId,
    },
    ...messages.map((message): Entry => ({
      kind: 'message',
      id: message.id,
      at: message.createdAt,
      mine: !message.isAiGenerated && message.senderId === viewerId,
      message,
    })),
    ...history
      .filter((change) => change.toStatus === 'ESCALATED')
      .map((change): Entry => ({
        kind: 'notice',
        id: `notice:${change.id}`,
        at: change.changedAt,
        mine: false,
        notice: { kind: 'escalated', at: change.changedAt, id: change.id },
      })),
    ...notices.map((notice): Entry => ({
      kind: 'notice',
      id: `notice:${notice.id}`,
      at: notice.at,
      mine: false,
      notice,
    })),
    ...pending
      .filter((send) => !(send.messageId && stored.has(send.messageId)))
      .map((send): Entry => ({
        kind: 'pending',
        id: `pending:${send.clientMessageId}`,
        at: send.createdAt,
        mine: true,
        pending: send,
      })),
    ...answers
      .filter((answer) => !(answer.messageId && stored.has(answer.messageId)))
      .filter((answer) => answer.state !== 'done' || answer.messageId)
      .map((answer): Entry => ({
        kind: 'answer',
        id: `answer:${answer.streamId}`,
        at: answer.startedAt,
        mine: false,
        answer,
      })),
  ];

  // Stable: entries with the same time keep the order above.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/**
 * The AI non-answers after which the requester may hand over to a person.
 * Only the latest one in the thread carries the button.
 */
export function lastNonAnswerId(entries: Entry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry.kind === 'message' &&
      entry.message.isAiGenerated &&
      (entry.message.answerStatus === 'DOC_MISSING' ||
        entry.message.answerStatus === 'REFUSED')
    ) {
      return entry.id;
    }
    if (
      entry.kind === 'answer' &&
      (entry.answer.state === 'failed' || entry.answer.state === 'stopped')
    ) {
      return entry.id;
    }
  }
  return null;
}
