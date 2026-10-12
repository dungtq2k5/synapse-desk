import type {
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
