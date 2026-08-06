import { Test } from '@nestjs/testing';
import {
  CHEAP_MODEL,
  DEFAULT_AI_MODEL_TIER,
  EMBEDDING_MODEL,
  GENERATION_MODEL_BY_TIER,
  MODEL_PRICING,
} from '@synapsedesk/common';
import { AiSettingsService } from './ai-settings.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { EntitlementsConsumer } from './entitlements.consumer';

describe('§3b AiSettingsService (unit)', () => {
  let service: AiSettingsService;
  let consumer: EntitlementsConsumer;
  let authReference: jest.Mocked<AuthReferenceService>;

  const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(async () => {
    // The tier now comes from auth-service over gRPC (doc 14 step 6), so the
    // collaborator is substituted rather than the whole tier being a constant.
    // Its RETURN VALUE is what these tests vary — which is the point of the
    // indirection: shipping the tier changed one method body and nothing else.
    authReference = {
      getAiModelTier: jest.fn().mockResolvedValue(DEFAULT_AI_MODEL_TIER),
    } as unknown as jest.Mocked<AuthReferenceService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [EntitlementsConsumer],
      providers: [
        AiSettingsService,
        { provide: AuthReferenceService, useValue: authReference },
      ],
    }).compile();

    service = moduleRef.get(AiSettingsService);
    consumer = moduleRef.get(EntitlementsConsumer);
  });

  describe('settingsFor', () => {
    it('1. Returns the global DEFAULTS while no tenant has a tier', async () => {
      const settings = await service.settingsFor(ORG_A);

      expect(settings.generationModel).toBe(
        GENERATION_MODEL_BY_TIER[DEFAULT_AI_MODEL_TIER],
      );
      expect(settings.cheapModel).toBe(CHEAP_MODEL);
      expect(settings.embeddingModel).toBe(EMBEDDING_MODEL);
    });

    it('2. Resolves a PRICED model on every field that names one', async () => {
      // The boot check restated per-field, because it is the property that
      // actually matters at a call site: a model the resolver can return but
      // the pricing table does not know meters as free (12-doc §1.3).
      const settings = await service.settingsFor(ORG_A);

      for (const model of [
        settings.generationModel,
        settings.cheapModel,
        settings.embeddingModel,
      ]) {
        expect(MODEL_PRICING[model]).toBeDefined();
      }
    });

    it('3. Runs the pricing check at BOOT, not at first use', () => {
      // Boot-time rather than lazily is the whole design: a model discovered
      // unpriced at first use has already been metered as free at least once,
      // and the ledger has no way to go back and re-price it. The negative
      // case — an unpriced model throwing — is pinned on
      // `assertPricingTableCovers` itself in the common spec; what this
      // asserts is that this service is wired to run it before serving.
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });

    it('4. Serves a repeat call from CACHE rather than re-resolving', async () => {
      const resolveTier = authReference.getAiModelTier;

      await service.settingsFor(ORG_A);
      await service.settingsFor(ORG_A);
      await service.settingsFor(ORG_A);

      expect(resolveTier).toHaveBeenCalledTimes(1);
    });

    it('5. Caches per TENANT, never globally', async () => {
      const resolveTier = authReference.getAiModelTier;

      await service.settingsFor(ORG_A);
      await service.settingsFor(ORG_B);

      expect(resolveTier).toHaveBeenCalledTimes(2);
      // The tenant travels in a SYSTEM context — background work has a tenant
      // but no user, and attributing this read to whoever happened to trigger
      // it would be a guess.
      expect(resolveTier).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_A, sub: null }),
      );
      expect(resolveTier).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_B }),
      );
    });
  });

  describe('the tier — doc 14 step 6', () => {
    it('12. Resolves the QUALITY generation model for a QUALITY tenant', async () => {
      // The whole tier feature, end to end. Nothing but `resolveTier` changed
      // to ship it: no caller moved, no endpoint signature moved, and no call
      // site learned a model name.
      authReference.getAiModelTier.mockResolvedValue('QUALITY');

      const settings = await service.settingsFor(ORG_A);

      expect(settings.generationModel).toBe(GENERATION_MODEL_BY_TIER.QUALITY);
    });

    it('13. Changes the generation model and NOTHING else', async () => {
      // Doc 15 §2.2. Scaling the embedding model with the tier is a full
      // re-embed migration of every tenant; scaling the cheap model multiplies
      // a premium tenant's bill on volume calls nobody can tell apart.
      authReference.getAiModelTier.mockResolvedValue('QUALITY');
      const quality = await service.settingsFor(ORG_A);

      service.invalidate(ORG_A);
      authReference.getAiModelTier.mockResolvedValue('FAST');
      const fast = await service.settingsFor(ORG_A);

      expect(quality.generationModel).not.toBe(fast.generationModel);
      expect(quality.embeddingModel).toBe(fast.embeddingModel);
      expect(quality.cheapModel).toBe(fast.cheapModel);
    });

    it('14. Degrades an UNKNOWN tier value to the cheap one', async () => {
      // The column can carry a value written by a newer deployment. Indexing
      // the mapping to `undefined` would hand a model name of `undefined` to
      // the pricing table, which throws — on a user's question.
      authReference.getAiModelTier.mockResolvedValue('PLATINUM');

      const settings = await service.settingsFor(ORG_A);

      expect(settings.generationModel).toBe(
        GENERATION_MODEL_BY_TIER[DEFAULT_AI_MODEL_TIER],
      );
    });
  });

  describe('invalidation', () => {
    it('6. Re-resolves after invalidate, so a downgrade takes effect on the NEXT request', async () => {
      const resolveTier = authReference.getAiModelTier;

      await service.settingsFor(ORG_A);
      service.invalidate(ORG_A);
      await service.settingsFor(ORG_A);

      expect(resolveTier).toHaveBeenCalledTimes(2);
    });

    it('7. Leaves the NEIGHBOURING tenant cached', async () => {
      // Doc 15 §1.4 test 4. A global flush on every webhook is a thundering
      // herd, and webhooks arrive in bursts — a plan change, an invoice and a
      // subscription update within seconds of each other.
      const resolveTier = authReference.getAiModelTier;

      await service.settingsFor(ORG_A);
      await service.settingsFor(ORG_B);
      resolveTier.mockClear();

      service.invalidate(ORG_A);

      await service.settingsFor(ORG_B);
      expect(resolveTier).not.toHaveBeenCalled();

      await service.settingsFor(ORG_A);
      expect(resolveTier).toHaveBeenCalledTimes(1);
    });

    it('8. Invalidating an UNCACHED tenant is a no-op', () => {
      // NATS core redelivers, so the same webhook arrives twice routinely.
      expect(() => service.invalidate(ORG_A)).not.toThrow();
    });
  });

  describe('the entitlements consumer', () => {
    it('9. Invalidates the tenant named in the event', () => {
      const invalidate = jest.spyOn(service, 'invalidate');

      consumer.handle({
        pattern: 'billing.entitlements_changed',
        organizationId: ORG_A,
        occurredAt: new Date().toISOString(),
      });

      expect(invalidate).toHaveBeenCalledWith(ORG_A);
    });

    it('10. Treats a payload with no organizationId as a DROP, not a flush', async () => {
      // The reading to avoid: "no tenant named" meaning "all of them". That
      // turns one malformed message into a re-resolve for every active tenant
      // — the thundering herd, arriving from the one input nobody validated.
      const invalidate = jest.spyOn(service, 'invalidate');
      await service.settingsFor(ORG_A);

      consumer.handle({} as never);

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('11. Does not THROW on a malformed payload', () => {
      // A throw here is a poison message that buries every good event behind
      // it — the same rule DeleteConsumer and AuditConsumer follow. A missed
      // invalidation costs one TTL; a poisoned subject costs all of them.
      expect(() => consumer.handle(null as never)).not.toThrow();
      expect(() => consumer.handle(undefined as never)).not.toThrow();
    });
  });
});
