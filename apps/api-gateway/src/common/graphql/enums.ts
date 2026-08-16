import { registerEnumType } from '@nestjs/graphql';
import {
  DocumentStatus,
  Gender,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';

/**
 * The domain enums, registered with the GraphQL schema
 *
 * **Registered once, here, rather than beside each type.** `registerEnumType`
 * is a side effect: calling it twice for the same enum throws at boot, and
 * calling it zero times makes every field using that enum fail schema
 * generation with a message about an unsupported type rather than a missing
 * registration. One file makes both failure modes impossible.
 *
 * The names are the enum's own — `TicketStatus`, not `TicketStatusEnum` — so a
 * client reading the SDL sees the same word the REST API returns in JSON.
 *
 * **Every registration, without exception.** `DocumentStatus` and `Gender` used
 * to sit at the top of their own type files, which read fine per-file and meant
 * the rule above was only half true: the guarantee "registered exactly once" is
 * worth nothing if it is enforced in one file and trusted in two others. It also
 * kept the enums in the feature modules, where the types no longer live — so
 * `dto/graphql/` folders would each have carried a side effect the surface as a
 * whole depends on.
 */
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

registerEnumType(Gender, { name: 'Gender' });
