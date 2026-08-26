import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@synapsedesk/common';
import { of, throwError } from 'rxjs';
import { AuthReferenceService } from './auth-reference.service';

/**
 * The cached read, and the two states its docblock makes claims about.
 *
 * A unit spec against a stubbed client: what is under test is the CACHE and the
 * failure direction, neither of which needs a database.
 */
describe('The attachment limit cache (unit)', () => {
  const serviceWith = (answers: (Record<string, unknown> | Error)[]) => {
    let call = 0;
    const service = new AuthReferenceService({
      getService: () => ({
        getCurrentOrganization: () => {
          const answer = answers[Math.min(call, answers.length - 1)];
          call += 1;

          return answer instanceof Error
            ? throwError(() => answer)
            : of(answer);
        },
      }),
    } as never);
    service.onModuleInit();

    return { service, calls: () => call };
  };

  const context = { organizationId: 'org-1', sub: 'user-1' } as never;

  afterEach(() => jest.useRealTimers());

  it('1. **a second read inside the window costs no second call**', async () => {
    // The whole reason this cache exists: without it there is a synchronous
    // cross-service hop on every attachment presign and every confirm, which is
    // the highest-volume path in the phase.
    const { service, calls } = serviceWith([
      { maxAttachmentBytesOverride: 2_000_000 },
    ]);

    await service.getAttachmentLimits(context);
    const second = await service.getAttachmentLimits(context);

    expect(calls()).toBe(1);
    expect(second.maxBytes).toBe(2_000_000);
  });

  it('2. **an EXPIRED entry is not served — it refetches**', async () => {
    // The other half. A cache that never expires is a tenant whose tightened
    // limit never takes effect.
    jest.useFakeTimers();
    const { service, calls } = serviceWith([
      { maxAttachmentBytesOverride: 2_000_000 },
      { maxAttachmentBytesOverride: 1_000_000 },
    ]);

    await service.getAttachmentLimits(context);
    jest.advanceTimersByTime(31_000);
    const after = await service.getAttachmentLimits(context);

    expect(calls()).toBe(2);
    expect(after.maxBytes).toBe(1_000_000);
  });

  it('**3. an unreachable peer REFUSES when the entry is populated and EXPIRED**', async () => {
    // The state the docblock used to mis-describe, and the one that has to be
    // constructed deliberately: a WARM entry returns before the peer is
    // touched, so "unreachable" would be unobservable and the test would pass
    // without entering the `catch` at all.
    //
    // **Serving the stale value is the tempting behaviour and is wrong.** The
    // cached number is precisely the WIDER limit a tenant has just narrowed, so
    // degrading to it during an outage hands them back the allowance they
    // revoked — at the one moment nothing can check.
    jest.useFakeTimers();
    const { service } = serviceWith([
      { maxAttachmentBytesOverride: 2_000_000 },
      new Error('auth-service is unreachable'),
    ]);

    await service.getAttachmentLimits(context);
    jest.advanceTimersByTime(31_000);

    await expect(service.getAttachmentLimits(context)).rejects.toThrow();
  });

  it('4. **an absent override resolves to the platform ceilings, never to zero**', async () => {
    // Absent is the normal state — most tenants never open the setting. The
    // `??` is what makes that true, and removing it yields `NaN`, which makes
    // every size comparison FALSE and the limit disappear.
    const { service } = serviceWith([{}]);

    await expect(service.getAttachmentLimits(context)).resolves.toEqual({
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    });
  });

  it('5. a stored override ABOVE the ceiling is clamped', async () => {
    // The control sabotage's finding, on the attachment side. Reachable by
    // lowering the platform constant under overrides that were legal when they
    // were written — which no write-path check can catch, because the write was
    // legal when it happened.
    const { service } = serviceWith([
      {
        maxAttachmentBytesOverride: MAX_ATTACHMENT_BYTES * 2,
        maxAttachmentsPerMessageOverride: MAX_ATTACHMENTS_PER_MESSAGE + 5,
      },
    ]);

    await expect(service.getAttachmentLimits(context)).resolves.toEqual({
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    });
  });
});
