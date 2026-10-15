import type {
  AssignmentResponseDto,
  TicketStatusChangeResponseDto,
} from '@synapsedesk/api-client';
import { ASSIGNMENT_REASON_LABEL, STATUS_LABEL } from './tickets';

/** One line of a ticket's history, before names are filled in. */
export type HistoryEvent =
  | {
      kind: 'status';
      id: string;
      at: string;
      from: string;
      to: string;
      byId: string;
      reason: string | null;
    }
  | {
      kind: 'assigned' | 'moved';
      id: string;
      at: string;
      toId: string;
      departmentId: string;
      byId: string;
      /** The reason in words, lowercased to follow a colon. */
      reason: string | null;
    }
  | { kind: 'unassigned'; id: string; at: string };

const reasonText = (reason: AssignmentResponseDto['reason']) =>
  reason ? ASSIGNMENT_REASON_LABEL[reason].toLowerCase() : null;

/**
 * A ticket's status changes and assignments as one timeline, newest first.
 * A department change reads "Moved to"; an assignment that ended with no
 * other one starting at that moment was an unassign.
 */
export function historyTimeline(
  changes: TicketStatusChangeResponseDto[],
  assignments: AssignmentResponseDto[],
): HistoryEvent[] {
  const starts = new Set(assignments.map((item) => item.assignedAt));
  const events: HistoryEvent[] = [
    ...changes.map((change): HistoryEvent => ({
      kind: 'status',
      id: change.id,
      at: change.changedAt,
      from: change.fromStatus ? STATUS_LABEL[change.fromStatus] : '—',
      to: change.toStatus ? STATUS_LABEL[change.toStatus] : '—',
      byId: change.changedById,
      reason: change.reason,
    })),
    ...assignments.flatMap((item): HistoryEvent[] => [
      {
        kind: item.reason === 'DEPARTMENT_CHANGE' ? 'moved' : 'assigned',
        id: item.id,
        at: item.assignedAt,
        toId: item.assignedToId,
        departmentId: item.departmentId,
        byId: item.assignedById,
        reason: reasonText(item.reason),
      },
      ...(item.unassignedAt && !starts.has(item.unassignedAt)
        ? [
            {
              kind: 'unassigned' as const,
              id: `${item.id}-end`,
              at: item.unassignedAt,
            },
          ]
        : []),
    ]),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at));
}
