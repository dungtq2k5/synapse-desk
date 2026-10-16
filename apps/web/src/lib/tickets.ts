import type {
  AssignTicketDtoReason,
  MessagesControllerListV1Params,
  TicketResponseDtoPriority,
  TicketResponseDtoSource,
  TicketResponseDtoStatus,
  TicketsControllerListV1Params,
} from '@synapsedesk/api-client';

/**
 * The list's first page: newest activity first. The server renders this page
 * and the browser asks for the same one, so the cache key matches and the
 * browser finds it hydrated.
 */
export const FIRST_PAGE: TicketsControllerListV1Params = {
  page: 1,
  limit: 10,
  sortBy: 'updatedAt',
  sortOrder: 'DESC',
};

/**
 * A ticket's thread: the newest 100 messages (shown oldest first). The server
 * renders the same page, so the key matches.
 */
// ponytail: one page of 100; "Load earlier" when threads outgrow it.
export const THREAD_PAGE: MessagesControllerListV1Params = {
  page: 1,
  limit: 100,
  sortBy: 'createdAt',
  sortOrder: 'DESC',
};

/**
 * Whether these permissions make someone an agent: ticket-service's own rule
 * (`TicketAccessService.isAgent`), holding `ticket.read.all` or
 * `ticket.message.moderate`. An agent sees internal notes and the full queue;
 * anyone else is a requester.
 */
export function isAgent(permissionCodes: readonly string[]): boolean {
  return (
    permissionCodes.includes('ticket.read.all') ||
    permissionCodes.includes('ticket.message.moderate')
  );
}

/** The label for each status, priority and source. */
export const STATUS_LABEL: Record<
  NonNullable<TicketResponseDtoStatus>,
  string
> = {
  NEW: 'New',
  OPEN: 'Open',
  PENDING_AGENT: 'Pending agent',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const PRIORITY_LABEL: Record<
  NonNullable<TicketResponseDtoPriority>,
  string
> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };

export const SOURCE_LABEL: Record<
  NonNullable<TicketResponseDtoSource>,
  string
> = {
  WEB: 'Web',
  CHAT: 'Chat',
  EMAIL: 'Email',
  API: 'API',
};

/** Statuses before a person has taken over: "Ask a person" is offered. */
export const BEFORE_ESCALATION: ReadonlySet<TicketResponseDtoStatus> = new Set([
  'NEW',
  'OPEN',
  'PENDING_AGENT',
]);

type Status = NonNullable<TicketResponseDtoStatus>;

/** Which route a move takes: the named ones, or `…/status` for the rest. */
export type MoveRoute = 'resolve' | 'close' | 'reopen' | 'escalate' | 'status';

/** One status move as its menu item and its dialog say it. */
export type StatusMove = {
  to: Status;
  route: MoveRoute;
  /** The permission it needs; `null` when anyone who sees the ticket may. */
  permission: 'ticket.update' | 'ticket.resolve' | null;
  item: string;
  title: (ticketNumber: number) => string;
  description: string;
  confirm: string;
  busy: string;
};

const FINISHED: ReadonlySet<Status> = new Set(['RESOLVED', 'CLOSED']);

/**
 * The moves from a status, as the server allows them
 * (`TICKET_STATUS_TRANSITIONS`), each with its route, its permission and its
 * words. Back to Open from a finished ticket is a reopen.
 */
export function statusMoves(
  from: Status,
  transitions: Record<Status, readonly string[]>,
): StatusMove[] {
  return transitions[from].map((to) => moveTo(to as Status, from));
}

function moveTo(to: Status, from: Status): StatusMove {
  switch (to) {
    case 'RESOLVED':
      return {
        to,
        route: 'resolve',
        permission: 'ticket.resolve',
        item: 'Resolve…',
        title: (n) => `Resolve ticket #${n}?`,
        description: 'The ticket moves to Resolved. It can be reopened later.',
        confirm: 'Resolve',
        busy: 'Resolving…',
      };
    case 'CLOSED':
      return {
        to,
        route: 'close',
        permission: 'ticket.resolve',
        item: 'Close…',
        title: (n) => `Close ticket #${n}?`,
        description:
          'The ticket moves to Closed. No one can reply until it’s reopened.',
        confirm: 'Close ticket',
        busy: 'Closing…',
      };
    case 'ESCALATED':
      return {
        to,
        route: 'escalate',
        permission: null,
        item: 'Escalate…',
        title: (n) => `Escalate ticket #${n}?`,
        description: 'The ticket moves to Escalated.',
        confirm: 'Escalate',
        busy: 'Escalating…',
      };
    case 'PENDING_AGENT':
      return {
        to,
        route: 'status',
        permission: 'ticket.update',
        item: 'Mark as pending agent…',
        title: (n) => `Mark ticket #${n} as pending agent?`,
        description: 'The ticket moves to Pending agent.',
        confirm: 'Mark as pending agent',
        busy: 'Saving…',
      };
    default:
      return FINISHED.has(from)
        ? {
            to,
            route: 'reopen',
            permission: 'ticket.update',
            item: 'Reopen…',
            title: (n) => `Reopen ticket #${n}?`,
            description: 'The ticket moves back to Open.',
            confirm: 'Reopen',
            busy: 'Reopening…',
          }
        : {
            to,
            route: 'status',
            permission: 'ticket.update',
            item: 'Mark as open…',
            title: (n) => `Mark ticket #${n} as open?`,
            description: 'The ticket moves to Open.',
            confirm: 'Mark as open',
            busy: 'Saving…',
          };
  }
}

/** Why a ticket moved to someone, in words. */
export const ASSIGNMENT_REASON_LABEL: Record<
  NonNullable<AssignTicketDtoReason>,
  string
> = {
  INITIAL: 'First assignment',
  DEPARTMENT_CHANGE: 'Department change',
  ESCALATION: 'Escalation',
  UNAVAILABLE: 'Assignee unavailable',
  LOAD_BALANCING: 'Load balancing',
  SELF_ASSIGNED: 'Self-assigned',
  MANUAL: 'Manual',
};

const TITLE_MIN = 3;
const TITLE_MAX = 255;

/**
 * The title a question is saved under: its first sentence, cut at the last
 * word boundary within 255 characters. A first sentence under 3 characters
 * gives way to the whole question, cut the same way; `null` when even that is
 * too short to be a title.
 *
 * @example titleFrom('When does the allowance reset? I started in March.') // 'When does the allowance reset?'
 * @example titleFrom('Hi') // null
 */
export function titleFrom(question: string): string | null {
  const whole = question.replace(/\s+/g, ' ').trim();
  const sentence = /^.*?[.!?](?=\s|$)/.exec(whole)?.[0] ?? whole;
  for (const text of [sentence, whole]) {
    const title = cutAtWord(text, TITLE_MAX);
    if (title.length >= TITLE_MIN) return title;
  }
  return null;
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).trim();
}
