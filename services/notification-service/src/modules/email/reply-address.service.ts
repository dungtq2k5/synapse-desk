import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  AUTH_GRPC_CLIENT,
  ORGANIZATION_SERVICE_NAME,
  type OrganizationServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  buildInboundAddress,
  buildTicketReplyToken,
  formatErrorMsg,
} from '@synapsedesk/common';

/**
 * The `Reply-To` that makes an email notification answerable.
 *
 * **This is the half that was missing.** The reply token, the address format
 * and the gateway that verifies them were all built before anything offered a
 * client an address to reply to, which made the entire threading design dead
 * code: every reply went to the bare sending address, carried no ticket token,
 * and opened a duplicate.
 *
 * **Returns `undefined` rather than throwing, always.** A tenant with no
 * inbound token has email switched off, and an auth-service blip must not stop
 * a notification going out — the cost of no `Reply-To` is a reply that opens a
 * new ticket, and the cost of a throw is the notification never arriving.
 */
@Injectable()
export class ReplyAddressService {
  private readonly logger = new Logger(ReplyAddressService.name);
  private organizations!: OrganizationServiceClient;

  constructor(
    @Inject(AUTH_GRPC_CLIENT) private readonly authClient: ClientGrpc,
    private readonly configService: ConfigService,
  ) {}

  private client(): OrganizationServiceClient {
    this.organizations ??=
      this.authClient.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );

    return this.organizations;
  }

  async forTicket(
    organizationId: string,
    ticketNumber: number,
  ): Promise<string | undefined> {
    try {
      const { inboundToken } = await firstValueFrom(
        this.client().getInboundToken({ organizationId }),
      );

      // Email is opt-in per tenant. No token means nobody can write in, so
      // there is no address to offer.
      if (!inboundToken) return undefined;

      const secret = this.configService.getOrThrow<string>(
        'INBOUND_EMAIL_SECRET',
      );
      const domain = this.configService.getOrThrow<string>(
        'INBOUND_EMAIL_DOMAIN',
      );

      return buildInboundAddress(
        domain,
        inboundToken,
        buildTicketReplyToken(organizationId, ticketNumber, secret),
      );
    } catch (error) {
      this.logger.warn(
        `Could not build a reply address for ${organizationId}: ${formatErrorMsg(error)}`,
      );

      return undefined;
    }
  }
}
