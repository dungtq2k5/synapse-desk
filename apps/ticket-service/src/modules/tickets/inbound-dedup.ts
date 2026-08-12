import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Prisma } from '../../generated/prisma/client';

/** Postgres unique-violation, as Prisma reports it. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * A write that has already been performed for this `Message-ID`.
 *
 * Thrown so the caller can answer with the EXISTING row rather than a failure:
 * a provider redelivery means the first attempt succeeded, so the correct
 * response is the thing it produced.
 */
export class InboundEmailAlreadyProcessed extends Error {
  constructor(readonly ticketId: string | null = null) {
    super('This inbound email has already been processed');
  }
}

/**
 * Records that an inbound message produced a write — 31-doc §6.2.
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
    // ASK Can we use `isUniqueConstraintViolation` in `/libs/common/.../prisma-errors.ts`?
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
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
      throw new InboundEmailAlreadyProcessed(null);
    }

    throw error;
  }
}

/**
 * The idempotency key for a message that carried no `Message-ID` — 31-doc §7.
 *
 * **Weaker than the header, and far better than nothing.** Without a key, a
 * retry storm creates one ticket per attempt; with this, two deliveries of the
 * same mail collide as they should. It can theoretically collide across two
 * genuinely different messages sent by the same person, with the same subject,
 * in the same second — at which point the second is dropped, which is the
 * failure this trades for.
 */
export function synthesizeMessageId(
  from: string,
  subject: string,
  receivedAt: string,
): string {
  return `synthesized:${from}:${subject}:${receivedAt}`;
}

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
