import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  AiModelTier,
  AiSettings,
  ALL_CONFIGURED_MODELS,
  asAiModelTier,
  assertPricingTableCovers,
  resolveAiSettings,
  systemContext,
} from '@synapsedesk/common';
import { AuthReferenceService } from '../auth-client/auth-reference.service';

/** How long a tenant's resolved settings survive without an invalidation. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * `settingsFor(orgId)` — the only source of model names in this service.
 *
 * The rule it exists to enforce: **no model name anywhere
 * except the settings module's defaults table.** Not in a service, not in a
 * prompt builder, not in a test fixture. `scripts/check-model-literals.mjs`
 * makes that mechanical, because the discipline decays exactly when someone is
 * debugging at speed.
 *
 * It is built now, before a single LLM call site exists, and that timing is the
 * entire point. Writing it alongside the call sites costs about an hour;
 * retrofitting it means auditing every LLM invocation across two services in
 * two languages. Everything the tier feature needs afterwards is
 * additive — one column read where `resolveTier` currently returns a constant.
 */
@Injectable()
export class AiSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiSettingsService.name);

  constructor(private readonly authReference: AuthReferenceService) {}

  private readonly cache = new Map<
    string,
    { settings: AiSettings; expiresAt: number }
  >();

  /**
   * Refuses to boot if any model the resolver can return is unpriced.
   *
   * At boot rather than at first use, and that distinction is the whole value:
   * an unpriced model discovered at first use has already been metered as free
   * at least once. This is also why the check reads
   * `ALL_CONFIGURED_MODELS` — derived from the mapping itself — rather than a
   * hand-written list that could drift away from what the resolver returns.
   */
  onApplicationBootstrap(): void {
    assertPricingTableCovers(ALL_CONFIGURED_MODELS);
  }

  /**
   * The resolved settings for one tenant, cached.
   *
   * Async despite resolving synchronously today. That is not speculative
   * generality: step 2 of the resolution order reads `ai_model_tier` over gRPC
   * and step 3 reads `organization_ai_settings` from Postgres, so the signature
   * would have to change the moment either lands — and it is called from every
   * AI request, which is exactly the set of call sites this layer exists to
   * avoid ever having to revisit.
   */
  async settingsFor(organizationId: string): Promise<AiSettings> {
    const cached = this.cache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.settings;
    }

    const settings = resolveAiSettings(await this.resolveTier(organizationId));

    this.cache.set(organizationId, {
      settings,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return settings;
  }

  /**
   * Drops ONE tenant's cached settings. Called by the entitlements consumer.
   *
   * One tenant, never all of them. Stripe webhooks arrive
   * in bursts — a plan change, an invoice, a subscription update within
   * seconds — and a global flush on each would re-resolve every active tenant
   * at once, at precisely the moment the system is least able to absorb it.
   */
  invalidate(organizationId: string): void {
    if (this.cache.delete(organizationId)) {
      this.logger.log(`Invalidated AI settings for org ${organizationId}`);
    }
  }

  /**
   * The tenant's tier, read over gRPC.
   *
   * **This method body is the entire tier feature**, and the claim
   * makes is now visible: nothing else changed to ship it. No caller moved, no
   * endpoint signature moved, and no call site learned a model name — the
   * mapping the settings layer already went through simply started receiving a
   * real value instead of a constant.
   *
   * Narrowed through `asAiModelTier`, so a column value from a newer deployment
   * degrades to the cheap tier rather than indexing the mapping to `undefined`
   * and handing a model name of `undefined` to the pricing table.
   */
  private async resolveTier(organizationId: string): Promise<AiModelTier> {
    const tier = await this.authReference.getAiModelTier(
      systemContext(organizationId),
    );

    return asAiModelTier(tier);
  }
}
