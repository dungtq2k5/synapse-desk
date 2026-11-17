import { Metadata } from '@grpc/grpc-js';
import type { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  AuditResourceType,
  systemContext,
  type CallerContext,
} from '@synapsedesk/contracts';
import {
  packRequestContext,
  unpackCallerContext,
} from '@synapsedesk/grpc-proto';
import {
  AuditPublisher,
  type JetStreamPublisher,
  requireActor,
  requireActorOrSystem,
  requireTenant,
} from '@synapsedesk/nest-common';

/**
 * Known gap 71: a background job's context, as a peer receives it. Packed,
 * sent through http2's header strings, and unpacked, as the wire does it.
 */
describe('A background job across a hop', () => {
  const organizationId = '0b6f3c1e-5d2a-4f0e-9c1b-7a8d2e4f6a10';

  const overTheWire = (context: CallerContext): CallerContext => {
    const sent = Object.fromEntries(
      Object.entries(packRequestContext(context).toHttp2Headers()).map(
        ([key, values]) => [key, [values].flat().map(String)],
      ),
    );
    return unpackCallerContext(Metadata.fromHttp2Headers(sent));
  };

  const job = () => overTheWire(systemContext(organizationId));

  it('is scoped to its tenant, is no actor, and is the system where one is allowed', () => {
    expect(requireTenant(job())).toBe(organizationId);
    expect(() => requireActor(job())).toThrow(
      'This operation requires an authenticated caller',
    );
    expect(requireActorOrSystem(job())).toBeNull();
  });

  it('**writes an audit entry with a null user, never the text "null"**', () => {
    const publish = jest.fn();
    const audit = new AuditPublisher(
      { publish } as unknown as JetStreamPublisher,
      { get: () => false } as unknown as ConfigService,
    );

    audit.record(job(), {
      action: AuditAction.USER_SESSIONS_REVOKED,
      resourceType: AuditResourceType.USER,
      resourceId: null,
    });

    expect(publish.mock.calls[0][1]).toMatchObject({
      userId: null,
      organizationId,
    });
  });
});
