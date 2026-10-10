/**
 * @file The domain enums, registered with the GraphQL schema.
 *
 * **Registered once, here, rather than beside each type.** `registerEnumType`
 * is a side effect: calling it twice for the same enum throws at boot, and
 * calling it zero times fails schema generation with a message about an
 * unsupported type rather than a missing registration. One file makes both
 * impossible.
 *
 * The names are the enum's own — `TicketStatus`, not `TicketStatusEnum` — so a
 * client reading the SDL sees the same word the REST API returns.
 *
 * **Every registration, without exception.** "Registered exactly once" is worth
 * nothing if it is enforced in one file and trusted in two others.
 */

import { registerEnumType } from '@nestjs/graphql';
import {
  DocumentStatus,
  Gender,
  IngestionJobStatus,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';

registerEnumType(TicketStatus, {
  name: 'TicketStatus',
  description:
    'Where a ticket sits in its lifecycle. Transitions are enforced by ' +
    'ticket-service, not by the client.',
});

registerEnumType(TicketPriority, {
  name: 'TicketPriority',
  description: 'How urgent the requester or an agent considers this ticket.',
});

registerEnumType(TicketSource, {
  name: 'TicketSource',
  description:
    'How the ticket arrived. `CHAT` is a self-service conversation; the ' +
    'others are raised through their named channel.',
});

registerEnumType(DocumentStatus, {
  name: 'DocumentStatus',
  description: 'Where a document sits in the ingestion pipeline.',
});

registerEnumType(IngestionJobStatus, {
  name: 'IngestionJobStatus',
  description:
    'Where one ingestion ATTEMPT sits. Distinct from `DocumentStatus`, which ' +
    'describes the document: a document can be READY while a later re-ingest ' +
    'attempt is FAILED.',
});

registerEnumType(Gender, { name: 'Gender' });
