import { Injectable, Logger } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  CallerContext,
  InvitationStatus,
  PLAN_SORTABLE_FIELDS,
  requireActor,
  type PlanLimitDimension,
} from '@synapsedesk/common';
import {
  emptyPage,
  fromProtoAiModelTier,
  toPageMeta,
  toPrismaPage,
} from '@synapsedesk/grpc-proto';
import type {
  ApplyPlanRequest,
  ApplyPlanResponse,
  CreatePlanRequest,
  ListPlansRequest,
  ListPlansResponse,
  PlanSubscriberProjection,
  SubscriptionPlanResponse,
  UpdatePlanRequest,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingEventPublisher } from './billing-event.publisher';
import {
  PLAN_INCLUDE,
  toSubscriptionPlanResponse,
  type PlanRow,
} from './plan.mapper';

/**
 * The dimensions `overLimit` actually checks.
 *
 * Seats only, and it is the honest half of a pair: `PLAN_LIMIT_DIMENSIONS`
 * names every limit an apply COULD put a tenant over, and the difference
 * between the two lists is what the response reports as unevaluated. Adding
 * storage means adding it here and to `overLimit` together — a list that
 * claimed a dimension this method does not compute is the exact inversion this
 * field exists to prevent.
 */
const EVALUATED_DIMENSIONS: readonly PlanLimitDimension[] = ['seats'];

/** A subscriber row, with the two counts a seat check needs. */
type SubscriberRow = {
  id: string;
  name: string;
  entitlementsPinned: boolean;
  maxAgentSeats: number;
  maxStorageBytes: bigint;
  monthlyAiTokenBudget: bigint;
  aiModelTier: string;
  maxDocumentBytes: bigint;
  maxAttachmentBytes: bigint;
};

/**
 * The plan catalogue as an ADMINISTERED thing — CRUD, and the fan-out.
 *
 * Separate from `PlanCatalogService`, which answers "what does this price
 * grant" on the webhook path and does nothing else. The two touch the same
 * tables and have opposite shapes: one is a hot single-row read that must fail
 * closed, this is a cross-tenant write that must be explicit and audited.
 *
 * **Nothing here calls `tenantScope`.** A plan is owned by no tenant and
 * applying one writes across every subscriber, which is the same deliberate
 * cross-tenant risk `PlatformService` carries — and the reason this surface is
 * reachable only through the platform gRPC controller behind `SuperAdminGuard`.
 */
@Injectable()
export class PlanAdminService {
  private readonly logger = new Logger(PlanAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly billingEvents: BillingEventPublisher,
  ) {}

  // ---------------------------------------------------------------- Read

  async listPlans(
    request: ListPlansRequest,
    context: CallerContext,
  ): Promise<ListPlansResponse> {
    // Not authorization — that is `SuperAdminGuard`'s at the gateway. This is
    // the contract suite's rule: an identity-less call must answer
    // UNAUTHENTICATED rather than reach Prisma and surface as UNKNOWN, which
    // the gateway has no mapping for and answers 500 to.
    requireActor(context);

    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(page, PLAN_SORTABLE_FIELDS);

    // `deletedAt: null` unless asked otherwise — §7.1, and the same filter
    // `PlanCatalogService` applies on the webhook path. A retired plan that
    // reappeared in a picker is a plan somebody can accidentally sell again.
    const where = {
      ...(request.includeDeleted ? {} : { deletedAt: null }),
      ...(request.includeInactive ? {} : { isActive: true }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where,
        include: PLAN_INCLUDE,
        // Defaults to creation order, which is how a ladder reads. There is no
        // price to sort by: what a plan costs lives in Stripe on purpose.
        orderBy,
        skip,
        take,
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    const items = rows.map(toSubscriptionPlanResponse);

    return { items, meta: toPageMeta(page, totalItems, items.length) };
  }

  async getPlan(
    planId: string,
    context: CallerContext,
  ): Promise<SubscriptionPlanResponse> {
    requireActor(context);

    return toSubscriptionPlanResponse(await this.load(planId));
  }

  // ---------------------------------------------------------------- Write

  async createPlan(
    request: CreatePlanRequest,
    context: CallerContext,
  ): Promise<SubscriptionPlanResponse> {
    requireActor(context);

    const name = request.name?.trim() ?? '';
    if (!name) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A plan needs a name',
      });
    }

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name,
        stripeProductId: request.stripeProductId ?? null,
        maxAgentSeats: request.maxAgentSeats,
        maxStorageBytes: BigInt(request.maxStorageBytes),
        monthlyAiTokenBudget: BigInt(request.monthlyAiTokenBudget),
        aiModelTier: this.tierName(request.aiModelTier),
        maxDocumentBytes: BigInt(request.maxDocumentBytes),
        maxAttachmentBytes: BigInt(request.maxAttachmentBytes),
        isActive: request.isActive,
        prices: {
          create: (request.prices ?? []).map((price) => ({
            stripePriceId: price.stripePriceId,
            interval: price.interval,
          })),
        },
      },
      include: PLAN_INCLUDE,
    });

    this.audit.record(context, {
      action: AuditAction.PLATFORM_PLAN_CREATED,
      resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
      resourceId: plan.id,
      // The event belongs to the PLATFORM, not to any customer — the same rule
      // every other cross-tenant write here follows.
      organizationId: null,
      metadata: { name: plan.name, isActive: plan.isActive },
    });

    return toSubscriptionPlanResponse(plan);
  }

  /**
   * Edits the catalogue row and NOTHING else.
   *
   * **No subscriber changes here, by design.** A silent fan-out on save would
   * rewrite two hundred tenants' entitlements from a form submit; `applyPlan`
   * is the explicit step that makes the blast radius something a person saw
   * rather than something they discovered.
   */
  async updatePlan(
    request: UpdatePlanRequest,
    context: CallerContext,
  ): Promise<SubscriptionPlanResponse> {
    requireActor(context);

    const existing = await this.load(request.planId);

    const plan = await this.prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        // `undefined` means "leave it" to Prisma, which is exactly what an
        // absent optional field means on the wire. Only `clear…` turns a value
        // into NULL, so a PATCH touching one grant cannot empty the row.
        ...(request.name === undefined ? {} : { name: request.name.trim() }),
        ...(request.clearStripeProductId
          ? { stripeProductId: null }
          : request.stripeProductId === undefined // NOSONAR
            ? {}
            : { stripeProductId: request.stripeProductId }),
        ...(request.maxAgentSeats === undefined
          ? {}
          : { maxAgentSeats: request.maxAgentSeats }),
        ...(request.maxStorageBytes === undefined
          ? {}
          : { maxStorageBytes: BigInt(request.maxStorageBytes) }),
        ...(request.monthlyAiTokenBudget === undefined
          ? {}
          : { monthlyAiTokenBudget: BigInt(request.monthlyAiTokenBudget) }),
        ...(request.aiModelTier === undefined
          ? {}
          : { aiModelTier: this.tierName(request.aiModelTier) }),
        ...(request.maxDocumentBytes === undefined
          ? {}
          : { maxDocumentBytes: BigInt(request.maxDocumentBytes) }),
        ...(request.maxAttachmentBytes === undefined
          ? {}
          : { maxAttachmentBytes: BigInt(request.maxAttachmentBytes) }),
        ...(request.isActive === undefined
          ? {}
          : { isActive: request.isActive }),
      },
      include: PLAN_INCLUDE,
    });

    this.audit.record(context, {
      action: AuditAction.PLATFORM_PLAN_UPDATED,
      resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
      resourceId: plan.id,
      organizationId: null,
      metadata: {
        name: plan.name,
        // The number that makes this row answerable later: an edit with
        // subscribers is a pending fan-out, an edit with none is bookkeeping.
        subscriberCount: plan._count.organizations,
      },
    });

    return toSubscriptionPlanResponse(plan);
  }

  /**
   * Retires a plan, and REFUSES while anyone is on it.
   *
   * Deactivate instead: `isActive: false` takes it off the pricing page while
   * the subscribers it already has keep the entitlements they are paying for.
   * A deleted plan with live subscribers would leave `organizations.plan_id`
   * pointing at a row every read filters out, and those tenants' entitlements
   * would have no explanation anywhere.
   */
  async deletePlan(planId: string, context: CallerContext): Promise<boolean> {
    requireActor(context);

    const existing = await this.load(planId);

    if (existing._count.organizations > 0) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `${existing._count.organizations} organization(s) are on this plan; deactivate it instead of deleting it`,
      });
    }

    await this.prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        // WHO retired it. `Restrict` keeps that user resolvable for as long as
        // the row lives, so the decision does not go anonymous.
        deletedById: context.sub ?? null,
        isActive: false,
      },
    });

    this.audit.record(context, {
      action: AuditAction.PLATFORM_PLAN_DELETED,
      resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
      resourceId: existing.id,
      organizationId: null,
      metadata: { name: existing.name },
    });

    return true;
  }

  // ---------------------------------------------------------------- Apply

  /**
   * Writes a plan's grants onto every subscriber — or projects what that would
   * do, when `dryRun` is set.
   *
   * **The projection is built by the same pass either way.** A dry run computed
   * by different code from the apply it predicts is worse than no dry run: it
   * would be believed, and it would be believed exactly when it was wrong.
   *
   * Three rules the loop encodes, each from D1 or D3:
   *
   *  - **A pinned tenant is skipped entirely.** Off-catalogue by deliberate
   *    policy; re-deriving from the plan is the silent revert the pin exists to
   *    prevent.
   *  - **A budget REDUCTION is not written.** Lowering a part-spent budget
   *    mid-cycle is retroactive in effect, so it waits for the cycle roll — the
   *    next subscription event re-derives every grant anyway. An INCREASE is
   *    applied now, because arriving early at a larger allowance harms nobody.
   *  - **Being over a new limit is REPORTED, never enforced.** A limit gates
   *    admission, never tenure. Nothing here deletes, deactivates or unindexes;
   *    the tenant keeps everything and is refused their next addition.
   *
   * @throws RpcException `NOT_FOUND` when the plan does not exist or is retired.
   */
  async applyPlan(
    request: ApplyPlanRequest,
    context: CallerContext,
  ): Promise<ApplyPlanResponse> {
    requireActor(context);

    const plan = await this.load(request.planId);
    const now = new Date();

    const subscribers = await this.prisma.organization.findMany({
      where: { planId: plan.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        entitlementsPinned: true,
        maxAgentSeats: true,
        maxStorageBytes: true,
        monthlyAiTokenBudget: true,
        aiModelTier: true,
        maxDocumentBytes: true,
        maxAttachmentBytes: true,
      },
      orderBy: { name: 'asc' },
    });

    const projections: PlanSubscriberProjection[] = [];

    for (const subscriber of subscribers) {
      const projection = await this.project(subscriber, plan, now);
      projections.push(projection);

      if (request.dryRun || projection.skippedPinned) continue;
      if (Object.keys(projection.changes).length === 0) continue;

      await this.write(subscriber, plan, projection.budgetDeferred);
      // Same announcement the webhook path makes, for the same consumers.
      this.billingEvents.publishEntitlementsChanged(subscriber.id);
    }

    const changed = projections.filter(
      (row) => !row.skippedPinned && Object.keys(row.changes).length > 0,
    ).length;
    const skipped = projections.filter((row) => row.skippedPinned).length;
    const overLimit = projections.filter(
      (row) => row.overLimit.length > 0,
    ).length;

    if (!request.dryRun) {
      this.audit.record(context, {
        action: AuditAction.PLATFORM_PLAN_APPLIED,
        resourceType: AuditResourceType.SUBSCRIPTION_PLAN,
        resourceId: plan.id,
        organizationId: null,
        metadata: {
          name: plan.name,
          subscriberCount: subscribers.length,
          changedCount: changed,
          skippedPinnedCount: skipped,
          // The blast radius, recorded at the moment somebody accepted it.
          overLimitCount: overLimit,
        },
      });

      this.logger.log(
        `Applied plan ${plan.name} to ${changed} of ${subscribers.length} subscribers (${skipped} pinned, ${overLimit} now over a limit)`,
      );
    }

    return {
      subscribers: projections,
      dryRun: request.dryRun,
      changedCount: changed,
      skippedPinnedCount: skipped,
      overLimitCount: overLimit,
      // What `overLimit` above ACTUALLY looked at. Everything else in
      // `PLAN_LIMIT_DIMENSIONS` was not evaluated, and the counts say nothing
      // about it — reporting a bare zero for storage would be a stronger claim
      // than this pass can make.
      evaluatedDimensions: [...EVALUATED_DIMENSIONS],
    };
  }

  // ---------------------------------------------------------------- Internals

  /** What this plan would do to ONE subscriber. Reads nothing it writes. */
  private async project(
    subscriber: SubscriberRow,
    plan: PlanRow,
    now: Date,
  ): Promise<PlanSubscriberProjection> {
    if (subscriber.entitlementsPinned) {
      return {
        organizationId: subscriber.id,
        organizationName: subscriber.name,
        changes: {},
        overLimit: [],
        skippedPinned: true,
        budgetDeferred: false,
      };
    }

    const changes: Record<string, string> = {};
    const diff = (field: string, before: unknown, after: unknown): void => {
      if (String(before) !== String(after)) {
        changes[field] = `${String(before)} -> ${String(after)}`;
      }
    };

    diff('maxAgentSeats', subscriber.maxAgentSeats, plan.maxAgentSeats);
    diff('maxStorageBytes', subscriber.maxStorageBytes, plan.maxStorageBytes);
    diff('aiModelTier', subscriber.aiModelTier, plan.aiModelTier);
    diff(
      'maxDocumentBytes',
      subscriber.maxDocumentBytes,
      plan.maxDocumentBytes,
    );
    diff(
      'maxAttachmentBytes',
      subscriber.maxAttachmentBytes,
      plan.maxAttachmentBytes,
    );

    // The budget is diffed either way — a Super Admin should see a deferred
    // reduction, not have it hidden until it silently lands weeks later.
    const budgetDeferred =
      plan.monthlyAiTokenBudget < subscriber.monthlyAiTokenBudget;
    diff(
      'monthlyAiTokenBudget',
      subscriber.monthlyAiTokenBudget,
      plan.monthlyAiTokenBudget,
    );

    return {
      organizationId: subscriber.id,
      organizationName: subscriber.name,
      changes,
      overLimit: await this.overLimit(subscriber, plan, now),
      skippedPinned: false,
      budgetDeferred,
    };
  }

  /**
   * Which of the new plan's limits this tenant is ALREADY past.
   *
   * Seats only, and that is a real gap rather than an oversight: storage usage
   * is `ingestion-service`'s to count, and answering it for every subscriber
   * would need a cross-tenant usage RPC that does not exist. Adding one beside
   * the tenant-scoped document RPCs is precisely the leak shape `platform.proto`
   * exists to avoid, so it wants its own separated surface — known-gaps #18.
   */
  private async overLimit(
    subscriber: SubscriberRow,
    plan: PlanRow,
    now: Date,
  ): Promise<string[]> {
    const over: string[] = [];

    // The same definition the tenant usage page and the invitation gate use:
    // an unspent invitation is a seat somebody is already holding.
    const [activeUsers, pendingInvitations] = await Promise.all([
      this.prisma.user.count({
        where: {
          organizationId: subscriber.id,
          deletedAt: null,
          isLocked: false,
        },
      }),
      this.prisma.userInvitation.count({
        where: {
          organizationId: subscriber.id,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
      }),
    ]);

    if (activeUsers + pendingInvitations > plan.maxAgentSeats) {
      over.push(
        `maxAgentSeats: ${activeUsers + pendingInvitations} in use, plan grants ${plan.maxAgentSeats}`,
      );
    }

    return over;
  }

  /** The write half. Never called on a dry run, never on a pinned tenant. */
  private async write(
    subscriber: SubscriberRow,
    plan: PlanRow,
    budgetDeferred: boolean,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: subscriber.id },
      data: {
        maxAgentSeats: plan.maxAgentSeats,
        maxStorageBytes: plan.maxStorageBytes,
        aiModelTier: plan.aiModelTier,
        maxDocumentBytes: plan.maxDocumentBytes,
        maxAttachmentBytes: plan.maxAttachmentBytes,
        // Omitted entirely when deferred, rather than written with the old
        // value: `undefined` leaves the column alone, and re-writing what is
        // already there would bump `updated_at` for a change that did not
        // happen.
        ...(budgetDeferred
          ? {}
          : { monthlyAiTokenBudget: plan.monthlyAiTokenBudget }),
      },
    });
  }

  private async load(planId: string): Promise<PlanRow> {
    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, deletedAt: null },
      include: PLAN_INCLUDE,
    });

    if (!plan) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Plan ${planId} not found`,
      });
    }

    return plan;
  }

  /**
   * The proto enum as the string the column holds — §7.3, ADR 0001.
   *
   * Refuses UNSPECIFIED rather than defaulting it. A plan states every grant it
   * makes, and silently writing `FAST` for a field the caller left blank is how
   * a catalogue row ends up selling something nobody chose.
   */
  private tierName(tier: number): string {
    const name = fromProtoAiModelTier(tier);

    if (!name) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A plan needs an explicit AI model tier',
      });
    }

    return name;
  }
}
