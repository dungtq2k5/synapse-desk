import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CitedDocumentFeedback,
  FEEDBACK_SERVICE_NAME,
  FeedbackServiceClient,
  GRPC_DEADLINE_MS,
  TICKET_GRPC_CLIENT,
  toProtoTimestamp,
} from '@synapsedesk/grpc-proto';

/** ticket-service, as the flag detection reads it. */
@Injectable()
export class TicketReferenceService implements OnModuleInit {
  private feedbackService!: FeedbackServiceClient;

  constructor(
    @Inject(TICKET_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.feedbackService = this.client.getService<FeedbackServiceClient>(
      FEEDBACK_SERVICE_NAME,
    );
  }

  /**
   * The ratings of AI answers since `since`, per document the answers cited.
   *
   * Called as the system: the tenant is a field of the request, and no caller
   * context is sent.
   *
   * @example
   * await tickets.citedDocumentFeedback(organizationId, ninetyDaysAgo)
   * // [{ documentId, ratings: 4, downvotes: 3, inaccurate: 0 }]
   */
  async citedDocumentFeedback(
    organizationId: string,
    since: Date,
  ): Promise<CitedDocumentFeedback[]> {
    const response = await firstValueFrom(
      this.feedbackService
        .listCitedDocumentFeedback({
          organizationId,
          since: toProtoTimestamp(since),
        })
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );

    return response.items;
  }
}
