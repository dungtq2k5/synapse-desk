import {
  fromProtoTimestamp,
  type ListCitedDocumentFeedbackRequest,
} from '@synapsedesk/grpc-proto';
import { of } from 'rxjs';
import { TicketReferenceService } from './ticket-reference.service';

/** What the flag detection asks ticket-service, against a stubbed client. */
describe('TicketReferenceService (unit)', () => {
  it('asks for one tenant’s ratings since a moment, and returns the items', async () => {
    const listCitedDocumentFeedback = jest.fn().mockReturnValue(
      of({
        items: [{ documentId: 'd1', ratings: 4, downvotes: 3, inaccurate: 0 }],
      }),
    );
    const service = new TicketReferenceService({
      getService: () => ({ listCitedDocumentFeedback }),
    } as never);
    service.onModuleInit();
    const since = new Date('2026-08-01T00:00:00Z');

    const items = await service.citedDocumentFeedback('org-1', since);

    expect(items).toEqual([
      { documentId: 'd1', ratings: 4, downvotes: 3, inaccurate: 0 },
    ]);
    const [request] = listCitedDocumentFeedback.mock.calls[0] as [
      ListCitedDocumentFeedbackRequest,
    ];
    expect(request.organizationId).toBe('org-1');
    expect(fromProtoTimestamp(request.since)).toEqual(since);
  });
});
