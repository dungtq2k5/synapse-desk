import { join } from 'node:path';

export const TICKET_PACKAGE_NAME = 'ticket';
export const TICKET_PROTO_PATH = join(__dirname, 'proto/ticket.proto');

export interface GetTicketRequest {
  id: string;
  organizationId: string;
}

export interface TicketResponse {
  id: string;
  title: string;
  status: string;
  priority: string;
}
