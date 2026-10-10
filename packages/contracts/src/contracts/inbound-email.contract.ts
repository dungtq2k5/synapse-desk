/**
 * @file Inbound email, as a domain event.
 *
 * **One event, and it flows gateway → notification-service.** The gateway is
 * the email adapter and knows a message was refused; it does not send mail, and
 * giving it a second way to would put two senders in one system.
 */

export const EMAIL_INBOUND_PATTERNS = {
  /**
   * Mail this system refused, and the sender should be told once.
   *
   * **An EVENT, not an RPC**. The webhook must answer 200 whatever
   * happens, so the drop path must not be able to fail because a mailbox was
   * slow. An RPC would couple the two, and the drop path is precisely the one
   * that must never throw.
   */
  rejected: 'email.inbound_rejected',
} as const;

/**
 * Why a message was refused.
 *
 * **Carried for the log, not for the reply.** The auto-reply template reads
 * none of these deliberately — "your address is not permitted in this
 * workspace" tells an outsider which tenants exist and who belongs to them,
 * which is an enumeration oracle at a public address. Both reasons render the
 * same "we could not accept this, please use the portal".
 */
export enum InboundRejectionReason {
  /**
   * The tenant resolved but is not accepting mail — suspended, or still in
   * `PENDING_ONBOARDING` with nobody to route to.
   *
   * **Not "no such tenant", despite the name.** An address that resolves to
   * nothing publishes NO event at all — see `organizationId` below.
   */
  UNROUTABLE = 'UNROUTABLE',
  /** A real, active tenant, but this sender may not open tickets in it. */
  SENDER_NOT_PERMITTED = 'SENDER_NOT_PERMITTED',
}

export type InboundEmailRejectedEvent = {
  pattern: typeof EMAIL_INBOUND_PATTERNS.rejected;
  /**
   * **Always set by the gateway — an unroutable address publishes nothing.**
   *
   * The tempting rule is the opposite one, and it was the rule here first: no
   * tenant is exactly the case where the sender learns least, so tell them.
   * That makes this system a BACKSCATTER source. `sender` is authenticated by
   * nothing — the signature proves Resend sent the delivery and says nothing
   * about whether the envelope sender is real — so mail to an address nobody
   * was issued, forged `From: victim@example.com`, would have this domain send
   * unsolicited mail to that victim. The per-address daily cap bounds volume
   * per victim and does nothing about the number of victims. Refusing an
   * unknown recipient belongs at the MTA, in the SMTP transaction, where the
   * sending server is told directly and no new mail is generated.
   *
   * `null` survives in the TYPE because this arrives over a wire and a consumer
   * that trusts its producer's invariants is a consumer one bad publish takes
   * down. The consumer drops such an event and logs it.
   */
  organizationId: string | null;
  /** Who to reply to. */
  sender: string;
  reason: InboundRejectionReason;
  /** ISO 8601, from the publisher's clock — the rule every contract here follows. */
  occurredAt: string;
};
