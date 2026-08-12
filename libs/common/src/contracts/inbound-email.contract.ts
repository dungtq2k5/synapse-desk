/**
 * Inbound email, as a domain event — 32-doc §5.
 *
 * **One event, and it flows gateway → notification-service.** The gateway is
 * the email adapter and knows a message was refused; it does not send mail, and
 * giving it a second way to would put two senders in one system.
 */

export const EMAIL_INBOUND_PATTERNS = {
  /**
   * Mail this system refused, and the sender should be told once.
   *
   * **An EVENT, not an RPC** — 32-doc §5. The webhook must answer 200 whatever
   * happens, so the drop path must not be able to fail because a mailbox was
   * slow. An RPC would couple the two, and the drop path is precisely the one
   * that must never throw.
   */
  rejected: 'email.inbound_rejected',
} as const;

/** Why a message was refused — carried to the sender, so it must be sayable. */
export enum InboundRejectionReason {
  /** The address resolved to no tenant, or to a deleted one. */
  UNROUTABLE = 'UNROUTABLE',
  /** A real tenant, but this sender may not open tickets in it. */
  SENDER_NOT_PERMITTED = 'SENDER_NOT_PERMITTED',
}

export type InboundEmailRejectedEvent = {
  pattern: typeof EMAIL_INBOUND_PATTERNS.rejected;
  /**
   * Absent when the address itself was unroutable — there is no tenant to scope
   * the reply to, and that is exactly the case where one still has to be sent.
   */
  organizationId: string | null;
  /** Who to reply to. */
  sender: string;
  reason: InboundRejectionReason;
  /** ISO 8601, from the publisher's clock — the rule every contract here follows. */
  occurredAt: string;
};
