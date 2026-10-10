import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { isUniqueConstraintViolation } from '@synapsedesk/common';
import { Prisma } from '../../generated/prisma/client';

/**
 * A write that has already been performed for this `Message-ID`.
 *
 * Thrown so the caller can answer a redelivery with success rather than a
 * failure: the provider retries by design, and the first attempt already
 * produced the ticket.
 *
 * **It carries nothing, and cannot.** An earlier version took the original
 * `ticketId` so the caller could answer with the existing row; that value is
 * unobtainable from where this is raised, for the reason `recordInboundEmail`
 * explains — the transaction is already aborted, so the read that would fetch
 * it throws first. The parameter survived as permanently `null` and nothing
 * ever read it.
 */
export class InboundEmailAlreadyProcessed extends Error {
  constructor() {
    super('This inbound email has already been processed');
  }
}

/**
 * Records that an inbound message produced a write.
 *
 * **Called INSIDE the caller's transaction**, which is the whole point. Dedup
 * written outside it can be recorded by a request that then fails, and the mail
 * is silently lost on the retry that should have recovered it: the second
 * delivery sees the row, concludes it already did the work, and returns
 * successfully having done nothing.
 *
 * A duplicate key means the mail was already accepted. That is the NORMAL path
 * — providers retry by design — so it raises {@link InboundEmailAlreadyProcessed}
 * carrying the original ticket rather than an error the caller has to interpret.
 */
export async function recordInboundEmail(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
  ticketId: string | null,
): Promise<void> {
  try {
    await tx.inboundEmail.create({
      data: { organizationId, messageId, ticketId },
    });
  } catch (error) {
    // Unnarrowed, deliberately: this insert touches one table with one unique
    // constraint, so `(organization_id, message_id)` is the only P2002 it can
    // raise. The `index` argument exists for rows guarded by several.
    if (isUniqueConstraintViolation(error)) {
      // **Nothing is read here, and that is not laziness.** Postgres puts a
      // transaction into a failed state as soon as a statement inside it
      // errors, so a `findUnique` for the original row would itself throw
      // "current transaction is aborted" — and THAT error would escape instead
      // of this one, which is exactly what happened the first time this was
      // written.
      //
      // The caller does not need the original id anyway: a redelivery means the
      // first attempt already succeeded, and the only useful answer is
      // ALREADY_EXISTS.
      throw new InboundEmailAlreadyProcessed();
    }

    throw error;
  }
}

// The key for a message with no `Message-ID` is SYNTHESIZED IN THE GATEWAY —
// `idempotencyKeyFor`. ticket-service receives a key and stays ignorant of
// email, so it has no business minting one — and `receivedAt`, the obvious
// input here, describes a delivery rather than the message, so a key built
// from it could differ between redeliveries and open a second ticket.

/**
 * Runs a write, turning a redelivery into `ALREADY_EXISTS`.
 *
 * **A gRPC status rather than an error, because the caller must answer 200.**
 * A provider retries on any non-2xx, so a redelivery reported as a failure
 * becomes an escalating retry storm carrying mail that has already been
 * accepted. `ALREADY_EXISTS` is the one code that means "your request was
 * satisfied, by an earlier attempt".
 */
export async function withInboundDedup<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof InboundEmailAlreadyProcessed) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'This inbound email has already been processed',
      });
    }

    throw error;
  }
}
