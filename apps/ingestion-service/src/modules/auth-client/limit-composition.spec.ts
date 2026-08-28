import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_TENANT,
} from '@synapsedesk/common';
import { of, throwError } from 'rxjs';
import { AuthReferenceService } from './auth-reference.service';

/**
 * `min(platform, plan, tenant)` — the read half of the layering rule.
 *
 * A unit spec against a stubbed client, because what is under test is the
 * COMPOSITION and its three edge values. The write half refuses a widening
 * value at two layers; this is what happens when a widening value is already
 * stored, which no amount of edge validation can rule out — a direct database
 * edit, a restore from a backup taken before a limit changed, or a platform
 * constant LOWERED in code under overrides that were legal when they were set.
 */
describe('The document size limit composition (unit)', () => {
  const serviceWith = (organization: Record<string, unknown> | Error) => {
    const service = new AuthReferenceService({
      getService: () => ({
        getCurrentOrganization: () =>
          organization instanceof Error
            ? throwError(() => organization)
            : // The plan grant defaults to the ceiling so a case that says
              // nothing about the plan is testing the OTHER two layers. A case
              // about the plan states its own value and wins the spread.
              of({ maxDocumentBytes: MAX_DOCUMENT_BYTES, ...organization }),
      }),
    } as never);
    service.onModuleInit();

    return service;
  };

  const context = { organizationId: 'org-1', sub: 'user-1' } as never;

  it('1. **a stored override ABOVE the ceiling is clamped, not honoured**', async () => {
    // The case edge validation cannot cover, and the one the whole rule is
    // written for: no layer widens. Reached by lowering `MAX_DOCUMENT_BYTES`
    // in code under an override that was legal when a tenant set it — at which
    // point every such tenant would silently keep the old, larger allowance.
    const service = serviceWith({
      maxDocumentBytesOverride: MAX_DOCUMENT_BYTES * 2,
    });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(
      MAX_DOCUMENT_BYTES,
    );
  });

  it('2. a stored override BELOW the ceiling is the answer', async () => {
    const service = serviceWith({ maxDocumentBytesOverride: 2_000_000 });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(
      2_000_000,
    );
  });

  it('3. **an ABSENT override resolves to the ceiling, never to zero**', async () => {
    // Absent is the normal state — most tenants never open the setting. A
    // `?? 0` here would refuse every upload in the system, which is the loudest
    // possible failure and therefore not the dangerous one; what makes it worth
    // pinning is that `0` is the value a careless default reaches for.
    const service = serviceWith({ maxDocumentBytesOverride: undefined });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(
      MAX_DOCUMENT_BYTES,
    );
  });

  it('**1b. the GUARD is what holds it, not the composition around it**', async () => {
    // The edit a reader is most likely to make, and the reason the `??` carries
    // a comment. `limit-composition` already covers absent, below, above and
    // unreadable — every state the guard PRODUCES — but not what the code does
    // once the guard is gone.
    //
    // Measured, because the chain is not obvious:
    //
    //   Number(undefined)        -> NaN
    //   Math.min(100_000_000, NaN) -> NaN
    //   sizeBytes > NaN          -> FALSE
    //
    // So a missing fallback does not throw and does not clamp: every size check
    // PASSES, and the tenant has no limit at all. This test pins the arithmetic
    // rather than the code, so it stays true if the composition is rewritten.
    const unguarded = Math.min(MAX_DOCUMENT_BYTES, Number(undefined));

    expect(unguarded).toBeNaN();
    // **The whole failure, in one assertion.** A 5 MB file is NOT greater than
    // the unguarded limit — not because it is small, but because every
    // comparison against `NaN` is false. The check does not throw and does not
    // clamp; it simply stops rejecting anything.
    expect(5_000_000).not.toBeGreaterThan(unguarded);

    // And the real path, with the guard in place, refuses the same file.
    const service = serviceWith({ maxDocumentBytesOverride: 2_000_000 });
    const limit = await service.getDocumentSizeLimitBytes(context);

    expect(limit).not.toBeNaN();
    expect(5_000_000).toBeGreaterThan(limit);
  });

  it('5. **the PLAN narrows, and it narrows a tenant that configured nothing**', async () => {
    // The PLAN layer. A Starter tenant that never opened the settings page is
    // still bounded by what its plan sells, not by the platform.
    const service = serviceWith({
      maxDocumentBytes: 25 * 1024 * 1024,
      maxDocumentBytesOverride: undefined,
    });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(
      25 * 1024 * 1024,
    );
  });

  it('6. **the NARROWER of plan and override wins, in both directions**', async () => {
    // Neither layer is privileged: whichever is smaller is the answer. The two
    // orderings are one test because a `min` that got the order wrong would
    // pass either of them alone.
    const planNarrower = serviceWith({
      maxDocumentBytes: 10_000_000,
      maxDocumentBytesOverride: 50_000_000,
    });
    const overrideNarrower = serviceWith({
      maxDocumentBytes: 50_000_000,
      maxDocumentBytesOverride: 10_000_000,
    });

    await expect(planNarrower.getDocumentSizeLimitBytes(context)).resolves.toBe(
      10_000_000,
    );
    await expect(
      overrideNarrower.getDocumentSizeLimitBytes(context),
    ).resolves.toBe(10_000_000);
  });

  it('7. **a plan grant ABOVE the platform ceiling does NOT widen it**', async () => {
    // `MAX_DOCUMENT_BYTES` protects the parser and is not sellable. A
    // catalogue row that tries to sell past it is bounded here, so the
    // mistake costs nothing at the enforcement point.
    const service = serviceWith({ maxDocumentBytes: MAX_DOCUMENT_BYTES * 4 });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(
      MAX_DOCUMENT_BYTES,
    );
  });

  it('8. **a MISSING plan grant refuses, where a missing override does not**', async () => {
    // The asymmetry that justifies two different `??` fallbacks one line
    // apart. The column is NOT NULL, so absent here is a broken wire and not a
    // tenant's choice — and the alternative, falling through to the ceiling,
    // would hand out the widest limit on the platform exactly when the
    // narrowing layer went missing.
    const service = serviceWith({
      maxDocumentBytes: undefined,
      maxDocumentBytesOverride: undefined,
    });

    await expect(service.getDocumentSizeLimitBytes(context)).resolves.toBe(0);
  });

  it('9. **the COUNT guard refuses on an absent grant, as the byte guard does**', async () => {
    // The gap the byte limits already covered and the count limit did not. Same
    // `??`, same reason, and the reason is about HOW it fails rather than
    // whether: the column is NOT NULL and the proto field is not `optional`, so
    // absent is a wire that lost a field — and `?? 0` makes that a refusal the
    // caller can read instead of `exceedsLimit` rejecting a `NaN` ceiling and
    // surfacing as a 500.
    const service = serviceWith({ maxDocumentUploads: undefined });

    await expect(service.getDocumentCountLimit(context)).resolves.toBe(0);
  });

  it('9b. …and a plan count ABOVE the platform cap does not widen it', async () => {
    const service = serviceWith({
      maxDocumentUploads: MAX_DOCUMENTS_PER_TENANT * 10,
    });

    await expect(service.getDocumentCountLimit(context)).resolves.toBe(
      MAX_DOCUMENTS_PER_TENANT,
    );
  });

  it('4. **an UNREADABLE organization refuses — it never means "unlimited"**', async () => {
    // Fails closed. Resolving to the platform ceiling is the tempting middle
    // ground and is still wrong: it hands a tenant that narrowed its limit the
    // wide one at exactly the moment the check could not run.
    const service = serviceWith(new Error('auth-service is down'));

    await expect(service.getDocumentSizeLimitBytes(context)).rejects.toThrow();
  });
});
