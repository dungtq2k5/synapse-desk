import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { GRPC_LOADER_OPTIONS, PROTO_ROOT } from './constants';

/**
 * `defaults: true` is a LIMIT, not a formatting preference.
 *
 * Every byte-count entitlement on the wire is a non-optional `int64`, and every
 * reader composes it with `Math.min`. What an ABSENT one decodes to therefore
 * decides whether a missing entitlement refuses an upload or removes the limit
 * entirely — and that is settled by this one loader option, three layers away
 * from any code that mentions a file size.
 *
 * Measured, both ways, in the test below rather than argued from the option's
 * name.
 */
describe('The proto loader defaults', () => {
  const protoPath = join(PROTO_ROOT, 'synapsedesk/auth/organization.proto');

  const decodeWithoutLimits = (defaults: boolean) => {
    const pkg = protoLoader.loadSync(protoPath, {
      ...GRPC_LOADER_OPTIONS,
      defaults,
    });

    const type = pkg['synapsedesk.auth.OrganizationResponse'] as unknown as {
      serialize: (value: object) => Buffer;
      deserialize: (value: Buffer) => Record<string, unknown>;
    };

    // A peer that never set the entitlement fields — an older build, or a
    // handwritten client.
    return type.deserialize(type.serialize({ id: 'o' }));
  };

  it('1. **an absent byte limit decodes to ZERO, which REFUSES**', () => {
    const decoded = decodeWithoutLimits(true);

    expect(decoded.maxAttachmentBytes).toBe(0);
    expect(decoded.maxDocumentBytes).toBe(0);
    // The composition every reader performs. Zero wins the `min`, so an
    // entitlement that never arrived refuses the upload.
    expect(Math.min(10_485_760, decoded.maxAttachmentBytes as number)).toBe(0);
  });

  it('2. **and `defaults: false` would make the same message UNLIMITED**', () => {
    // The mutation this file exists to catch. It looks like a wire-format
    // tidy-up — "do not send fields nobody set" — and it silently converts
    // every size check in the system into a comparison against `NaN`, which is
    // false for every operand. No error, no log, no limit.
    const decoded = decodeWithoutLimits(false);

    expect(decoded.maxAttachmentBytes).toBeUndefined();
    expect(
      Math.min(10_485_760, decoded.maxAttachmentBytes as number),
    ).toBeNaN();
    // 100 MB is NOT greater than that limit. Nothing is.
    expect(100_000_000).not.toBeGreaterThan(
      Math.min(10_485_760, decoded.maxAttachmentBytes as number),
    );
  });

  it('3. so the shipped options say `true`', () => {
    expect(GRPC_LOADER_OPTIONS.defaults).toBe(true);
  });

  it('4. an OPTIONAL field stays absent either way', () => {
    // The contrast that makes the two `??` fallbacks in the readers differ.
    // `defaults: true` fills a non-optional field with its zero value and
    // leaves an `optional` one undefined — which is exactly the distinction
    // the tenant overrides rely on: absent means "configured nothing", and
    // a reader must fall through to the layer above rather than to zero.
    expect(
      decodeWithoutLimits(true).maxAttachmentBytesOverride,
    ).toBeUndefined();
  });
});
