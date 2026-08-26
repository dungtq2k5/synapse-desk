import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
} from '@synapsedesk/common';
import { of } from 'rxjs';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
} from '../utils';

/**
 * The layering rule at the HTTP boundary.
 *
 * ```txt
 * platform ceiling (constant) >= plan grant (later) >= tenant config >= request
 * ```
 *
 * **Every layer narrows and no layer widens.** A tenant setting a limit ABOVE
 * the platform constant is not a bigger allowance, it is a self-service
 * entitlement grant — and that is the single outcome this surface exists to
 * make impossible. auth-service re-checks the same numbers; this is the layer
 * that refuses before a network hop and names the field.
 */
describe('Tenant limit overrides at the HTTP boundary (e2e)', () => {
  let fx: E2eFixture;

  const admin = () =>
    authenticatedAgent(fx.app, {
      permissionCodes: ['organization.update', 'organization.read'],
    });

  /** A settings response with nothing configured — the normal state. */
  const stubSettings = (overrides: Record<string, unknown> = {}) =>
    fx.stubs.organization.updateOrganizationSettings.mockReturnValue(
      of({
        enforceTwoFactor: false,
        allowedEmailDomains: [],
        publicDomainWarnings: [],
        ...overrides,
      }),
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
  }, 30_000);

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => fx.close());

  describe('the narrowing direction', () => {
    it('**2. an override ABOVE the platform ceiling is REFUSED, not clamped**', async () => {
      // The security property, and the first test written for this feature.
      //
      // **A clamp would be worse than a refusal**, not merely different: it
      // accepts a request whose intent it did not honour, and the caller has no
      // way to learn that its 500 MB became 100. The tenant then believes it
      // raised its limit, which is exactly the belief the layering rule exists
      // to prevent anyone holding.
      stubSettings();

      const res = await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ maxDocumentBytesOverride: MAX_DOCUMENT_BYTES + 1 });

      expect(res.status).toBe(400);
      // Names the FIELD. A caller fixing a rejected settings form needs to know
      // which of three numbers was wrong.
      expect(JSON.stringify(res.body)).toContain('maxDocumentBytesOverride');
      // And it never reached auth-service.
      expect(
        fx.stubs.organization.updateOrganizationSettings,
      ).not.toHaveBeenCalled();
    });

    it('**2b. …and the same holds for both attachment ceilings**', async () => {
      // Test 2 alone passes for a DTO that guards one field of three. The
      // per-message count is the one most likely to be missed: it is a small
      // integer beside two byte counts, and it reads like a preference.
      stubSettings();

      for (const [field, ceiling] of [
        ['maxAttachmentBytesOverride', MAX_ATTACHMENT_BYTES],
        ['maxAttachmentsPerMessageOverride', MAX_ATTACHMENTS_PER_MESSAGE],
      ] as const) {
        const res = await admin()
          .patch(`${API}/organizations/current/settings`)
          .send({ [field]: ceiling + 1 });

        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain(field);
      }

      expect(
        fx.stubs.organization.updateOrganizationSettings,
      ).not.toHaveBeenCalled();
    });

    it('3. **a value AT the ceiling is accepted** — the boundary is inclusive', async () => {
      // The pair for test 2. Without it, `@Max` could be off by one in the
      // strict direction and every test above would still pass, while a tenant
      // that wanted exactly the platform maximum could not say so.
      stubSettings({ maxDocumentBytesOverride: MAX_DOCUMENT_BYTES });

      const res = await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ maxDocumentBytesOverride: MAX_DOCUMENT_BYTES });

      expect(res.status).toBe(200);
    });

    it('**4. zero is refused** — a limit of nothing is not a way to clear one', async () => {
      // `@Min(1)` earns its place here specifically. Zero would be accepted by
      // a naive range check, stored, and then refuse every upload the tenant
      // ever makes — and it is the value somebody reaches for when they mean
      // "no limit", which is the opposite instruction.
      stubSettings();

      const res = await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ maxAttachmentBytesOverride: 0 });

      expect(res.status).toBe(400);
    });
  });

  describe('absence, null and value are three different instructions', () => {
    it('**5. an explicit `null` CLEARS the override**', async () => {
      // `@IsNullable`, not `@IsOptional`, and this is the difference. Treating
      // them alike would leave a tenant no way to undo a limit it had set —
      // the field would be write-once for the life of the workspace.
      stubSettings();

      await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ maxDocumentBytesOverride: null })
        .expect(200);

      const [[sent]] =
        fx.stubs.organization.updateOrganizationSettings.mock.calls;
      const request = sent as {
        clearMaxDocumentBytesOverride: boolean;
        maxDocumentBytesOverride?: number;
      };

      expect(request.clearMaxDocumentBytesOverride).toBe(true);
      // The value is ABSENT, not zero — the clear flag carries the whole
      // instruction, and a `0` beside it would be a second, contradictory one.
      expect(request.maxDocumentBytesOverride).toBeUndefined();
    });

    it('**6. an ABSENT key leaves the override alone**', async () => {
      // The other half of test 5, and the one that protects every unrelated
      // settings update. An admin toggling two-factor must not silently clear
      // the workspace's upload limits — the same trap `allowedEmailDomains`
      // already documents on this endpoint.
      stubSettings();

      await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ enforceTwoFactor: true })
        .expect(200);

      const [[sent]] =
        fx.stubs.organization.updateOrganizationSettings.mock.calls;
      const request = sent as unknown as Record<string, unknown>;

      expect(request.clearMaxDocumentBytesOverride).toBe(false);
      expect(request.clearMaxAttachmentBytesOverride).toBe(false);
      expect(request.clearMaxAttachmentsPerMessageOverride).toBe(false);
      expect(request.maxDocumentBytesOverride).toBeUndefined();
    });

    it('**7. a value below the ceiling travels as a value**', async () => {
      stubSettings({ maxDocumentBytesOverride: 2_000_000 });

      await admin()
        .patch(`${API}/organizations/current/settings`)
        .send({ maxDocumentBytesOverride: 2_000_000 })
        .expect(200);

      const [[sent]] =
        fx.stubs.organization.updateOrganizationSettings.mock.calls;
      const request = sent as {
        maxDocumentBytesOverride?: number;
        clearMaxDocumentBytesOverride: boolean;
      };

      expect(request.maxDocumentBytesOverride).toBe(2_000_000);
      expect(request.clearMaxDocumentBytesOverride).toBe(false);
    });

    it('**8. an unset override reads back as `null`, never as the ceiling**', async () => {
      // A screen that renders the platform number as though the tenant chose it
      // cannot show the difference between an inherited limit and a deliberate
      // one — and the admin has no way to tell whether clearing the field would
      // change anything.
      fx.stubs.organization.getOrganizationSettings.mockReturnValue(
        of({
          enforceTwoFactor: false,
          allowedEmailDomains: [],
          publicDomainWarnings: [],
        }),
      );

      const res = await admin()
        .get(`${API}/organizations/current/settings`)
        .expect(200);

      expect(res.body.data.maxDocumentBytesOverride).toBeNull();
      expect(res.body.data.maxAttachmentBytesOverride).toBeNull();
      expect(res.body.data.maxAttachmentsPerMessageOverride).toBeNull();
    });
  });
});
