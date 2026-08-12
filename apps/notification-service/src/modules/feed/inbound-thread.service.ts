import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationResourceType,
} from '@synapsedesk/common';
import type {
  ResolveTicketByMessageIdRequest,
  ResolveTicketByMessageIdResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ticket an outbound notification was about — 31-doc §4.
 *
 * **The `In-Reply-To` fallback, and it lives here because the data does.** A
 * reply that carries no ticket token — someone answering a forwarded copy, or
 * writing to the bare support address about an existing issue — echoes back the
 * `Message-ID` of the mail it is replying to. That id is in
 * `notification_deliveries`, and the ticket it was about is on the
 * `notifications` row above it. Two hops, both in this database, which is why
 * this is an RPC rather than a column ticket-service could read.
 *
 * **Without a fallback every such reply opens a duplicate ticket**, which is
 * the visible-but-annoying failure 31-doc §4 prefers to a misthread — this
 * turns most of those duplicates back into replies.
 */
@Injectable()
export class InboundThreadService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveTicketByMessageId(
    request: ResolveTicketByMessageIdRequest,
  ): Promise<ResolveTicketByMessageIdResponse> {
    const providerMessageId = request.providerMessageId?.trim();

    // Guarded before Prisma: an empty id would query for `undefined` and raise
    // a validation error the caller would see as UNKNOWN rather than "no
    // match", and "no match" is the normal answer here.
    if (!providerMessageId || !request.organizationId) {
      return { ticketId: undefined };
    }

    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: {
        providerMessageId,
        channel: NotificationChannel.EMAIL,
        notification: {
          // **Scoped to the addressed tenant.** A `Message-ID` lifted from one
          // tenant's notification must not resolve to that tenant's ticket
          // while the mail was addressed to another — the same cross-tenant
          // misroute the reply token's MAC prevents by binding the tenant.
          organizationId: request.organizationId,
          resourceType: NotificationResourceType.TICKET,
        },
      },
      // Newest first: one `Message-ID` should be unique, but the column is not
      // constrained to be, and a stale duplicate must not win over a current
      // one.
      orderBy: { createdAt: 'desc' },
      select: { notification: { select: { resourceId: true } } },
    });

    return { ticketId: delivery?.notification?.resourceId ?? undefined };
  }
}
