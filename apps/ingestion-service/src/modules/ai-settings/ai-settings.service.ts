import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  AiModelTier,
  AiSettings,
  ALL_CONFIGURED_MODELS,
  DEFAULT_AI_MODEL_TIER,
  assertPricingTableCovers,
  resolveAiSettings,
} from '@synapsedesk/common';

/** How long a tenant's resolved settings survive without an invalidation. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * `settingsFor(orgId)` — the only source of model names in this service.
 *
 * The rule it exists to enforce is doc 15 §1.2: **no model name anywhere
 * except the settings module's defaults table.** Not in a service, not in a
 * prompt builder, not in a test fixture. `scripts/check-model-literals.mjs`
 * makes that mechanical, because the discipline decays exactly when someone is
 * debugging at speed.
 *
 * It is built now, before a single LLM call site exists, and that timing is the
 * entire point. Writing it alongside the call sites costs about an hour;
 * retrofitting it means auditing every LLM invocation across two services in
 * two languages (11-doc §1.7). Everything the tier feature needs afterwards is
 * additive — one column read where `resolveTier` currently returns a constant.
 */
@Injectable()
export class AiSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiSettingsService.name);

  private readonly cache = new Map<
    string,
    { settings: AiSettings; expiresAt: number }
  >();

  /**
   * Refuses to boot if any model the resolver can return is unpriced.
   *
   * At boot rather than at first use, and that distinction is the whole value:
   * an unpriced model discovered at first use has already been metered as free
   * at least once (12-doc §1.3). This is also why the check reads
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
   * One tenant, never all of them (doc 15 §1.4 test 4). Stripe webhooks arrive
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
   * Where the tier will come from — and today it comes from nowhere.
   *
   * `organizations.ai_model_tier` does not exist yet: it is written by the
   * Stripe webhook (doc 14 §3) and read here over `GetOrganizationEntitlements`
   * (doc 15 §3.1). Until then every tenant resolves to the default.
   *
   * **The constant is returned from HERE rather than from `settingsFor`**, and
   * that is the difference between this being finished work and a stub. The
   * call sites already go through the mapping; shipping the tier is replacing
   * this method body, with no caller and no endpoint signature moving —
   * which is the claim doc 15 §1.1 makes about step 3 being a data change.
   */
  private resolveTier(organizationId: string): Promise<AiModelTier> {
    this.logger.debug(`Resolving AI tier for org ${organizationId}`);

    // Returns a promise without being `async`: there is nothing to await yet,
    // and `async` on a body with no `await` is a lint error in this repo. The
    // RETURN TYPE is what callers depend on, and it is already the one a gRPC
    // entitlements read will need.
    return Promise.resolve(DEFAULT_AI_MODEL_TIER);
  }
}
