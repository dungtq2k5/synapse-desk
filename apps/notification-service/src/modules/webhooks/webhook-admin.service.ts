import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  MAX_WEBHOOK_ENDPOINTS,
  MAX_WEBHOOK_URL_LENGTH,
  NOTIFICATION_TYPE_VALUES,
  WEBHOOK_DELIVERY_LIMIT,
  WEBHOOK_ROTATION_OVERLAP_HOURS,
  requireTenant,
  type CallerContext,
  type NotificationType,
  type WebhookEventPayload,
} from '@synapsedesk/common';
import {
  fromProtoNotificationType,
  toProtoNotificationType,
  NotificationType as ProtoNotificationType,
} from '@synapsedesk/grpc-proto';
import type {
  CreateWebhookEndpointRequest,
  ListWebhookDeliveriesRequest,
  ListWebhookDeliveriesResponse,
  ListWebhookEndpointsResponse,
  ListWebhookEventTypesResponse,
  TestWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  WebhookEndpointResponse,
  WebhookEndpointWithSecretResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookSenderService } from './webhook-sender.service';
import { deniedLiteral, privateTargetsAllowed } from './webhook-target.guard';
import {
  toWebhookDeliveryResponse,
  toWebhookEndpointResponse,
} from './webhook.mapper';

/**
 * Tenant management of webhook endpoints.
 *
 * **Every read and write is scoped to the caller's tenant** — the endpoint id
 * alone never selects a row, so "rotate somebody else's secret" is
 * unexpressible rather than merely refused, the same shape the feed's
 * self-scoping records.
 */
@Injectable()
export class WebhookAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WebhookSenderService,
    private readonly configService: ConfigService,
  ) {}

  async list(context: CallerContext): Promise<ListWebhookEndpointsResponse> {
    const organizationId = requireTenant(context);

    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    return { items: rows.map(toWebhookEndpointResponse) };
  }

  async get(
    endpointId: string,
    context: CallerContext,
  ): Promise<WebhookEndpointResponse> {
    return toWebhookEndpointResponse(await this.load(endpointId, context));
  }

  async create(
    request: CreateWebhookEndpointRequest,
    context: CallerContext,
  ): Promise<WebhookEndpointWithSecretResponse> {
    const organizationId = requireTenant(context);

    this.assertUrl(request.url);
    const eventTypes = this.assertEventTypes(request.eventTypes);

    // A cap, not a plan dimension — this bounds abuse, not billing, so it is a
    // constant rather than a grant.
    const existing = await this.prisma.webhookEndpoint.count({
      where: { organizationId },
    });

    if (existing >= MAX_WEBHOOK_ENDPOINTS) {
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `A workspace can register at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints`,
      });
    }

    const secret = newSecret();

    const row = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: request.url,
        description: request.description ?? null,
        eventTypes,
        secret,
      },
    });

    // **The secret rides only here and on rotate — shown once.** A listing
    // that repeated it would make every read of the settings page a copy of
    // the signing key.
    return { endpoint: toWebhookEndpointResponse(row), secret };
  }

  async update(
    request: UpdateWebhookEndpointRequest,
    context: CallerContext,
  ): Promise<WebhookEndpointResponse> {
    const current = await this.load(request.endpointId, context);

    if (request.url !== undefined) this.assertUrl(request.url);

    const eventTypes =
      request.eventTypes === undefined
        ? undefined
        : this.assertEventTypes(request.eventTypes.values);

    const row = await this.prisma.webhookEndpoint.update({
      where: { id: current.id },
      data: {
        ...(request.url === undefined ? {} : { url: request.url }),
        ...(request.description === undefined
          ? {}
          : { description: request.description }),
        ...(eventTypes === undefined ? {} : { eventTypes }),
        ...(request.isActive === undefined
          ? {}
          : {
              isActive: request.isActive,
              // A tenant's own enable/disable clears OUR reason and the
              // streak: re-enabling after a fix must not inherit nine strikes
              // from before it.
              disabledReason: null,
              consecutiveFailures: 0,
            }),
      },
    });

    return toWebhookEndpointResponse(row);
  }

  async delete(
    endpointId: string,
    context: CallerContext,
  ): Promise<{ deleted: boolean }> {
    const current = await this.load(endpointId, context);

    // Hard delete, cascading the delivery history: an endpoint is a
    // credentialed integration, and "removed" meaning "still listed somewhere"
    // is the wrong surprise for a security surface.
    await this.prisma.webhookEndpoint.delete({ where: { id: current.id } });

    return { deleted: true };
  }

  async rotateSecret(
    endpointId: string,
    context: CallerContext,
  ): Promise<WebhookEndpointWithSecretResponse> {
    const current = await this.load(endpointId, context);
    const secret = newSecret();

    const row = await this.prisma.webhookEndpoint.update({
      where: { id: current.id },
      data: {
        secret,
        // The overlap as STATE: while the expiry is in the future the sender
        // signs with both, so the customer rolls without dropping events.
        // Rotating twice inside the window forgets the oldest — one previous
        // secret is the overlap, not a history.
        previousSecret: current.secret,
        previousSecretExpiresAt: new Date(
          Date.now() + WEBHOOK_ROTATION_OVERLAP_HOURS * 60 * 60 * 1000,
        ),
      },
    });

    return { endpoint: toWebhookEndpointResponse(row), secret };
  }

  /**
   * `POST …/test` — the delivery path, never a shortcut around it.
   *
   * Same sender, same SSRF guard, same signature. An unguarded "send a test
   * event" is an SSRF endpoint with a friendly name, and a test that skipped
   * the guard would green-light URLs the real path refuses.
   */
  async test(
    endpointId: string,
    context: CallerContext,
  ): Promise<TestWebhookEndpointResponse> {
    const current = await this.load(endpointId, context);

    const payload: WebhookEventPayload = {
      id: `test:${current.id}:${Date.now()}`,
      // A real member of the vocabulary, so a receiver's type switch sees a
      // value it will see again. The `data` flag is what marks it synthetic.
      type: current.eventTypes[0] as NotificationType,
      occurredAt: new Date().toISOString(),
      organizationId: current.organizationId,
      resourceType: null,
      resourceId: null,
      data: { test: true },
    };

    const outcome = await this.sender.send(current, payload);

    return outcome.delivered
      ? { delivered: true, responseStatus: outcome.statusCode }
      : {
          delivered: false,
          responseStatus: outcome.statusCode,
          error: outcome.error,
        };
  }

  async listDeliveries(
    request: ListWebhookDeliveriesRequest,
    context: CallerContext,
  ): Promise<ListWebhookDeliveriesResponse> {
    const current = await this.load(request.endpointId, context);

    // The same `MAX` the gateway's query DTO enforces — shared through the
    // contract so the two clamps cannot drift. The fallback-to-MAX for a
    // missing limit only fires for direct gRPC callers; REST traffic arrives
    // with the DTO's default already applied.
    const limit = Math.min(
      request.limit > 0 ? request.limit : WEBHOOK_DELIVERY_LIMIT.MAX,
      WEBHOOK_DELIVERY_LIMIT.MAX,
    );

    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: current.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { items: rows.map(toWebhookDeliveryResponse) };
  }

  /**
   * The catalogue — what a customer can subscribe to.
   *
   * The whole `NotificationType` vocabulary, so "not subscribed" and "never
   * happened" stay distinguishable (known-gap #25, from the provider's side
   * this time).
   */
  listEventTypes(): ListWebhookEventTypesResponse {
    // Sorted on the DOMAIN value, so the catalogue keeps reading alphabetically
    // by name rather than by whatever order the enum numbers happen to be in.
    return {
      types: [...NOTIFICATION_TYPE_VALUES].sort().map(toProtoNotificationType), // NOSONAR
    };
  }

  // ---------------------------------------------------------------- Internals

  private async load(endpointId: string, context: CallerContext) {
    const organizationId = requireTenant(context);

    const row = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, organizationId },
    });

    if (!row) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No webhook endpoint with that id',
      });
    }

    return row;
  }

  private assertUrl(url: string): void {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'The endpoint URL does not parse',
      });
    }

    // The string checks are a COURTESY, not the control — the URL is resolved
    // at delivery time and DNS can change in between, which is why the real
    // check lives in the sender (the guarded `lookup` for hostnames, the
    // literal check for IP hosts). Refusing the obvious cases here just gives
    // the tenant their error at save time instead of on the first event.
    if (parsed.protocol !== 'https:') {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Webhook endpoints must be https',
      });
    }

    if (url.length > MAX_WEBHOOK_URL_LENGTH) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `The URL must be at most ${MAX_WEBHOOK_URL_LENGTH} characters`,
      });
    }

    // A private IP LITERAL is refusable now, because for a literal there is no
    // resolution and so no later fact this answer could disagree with. Honours
    // the same development hatch as the sender, so a dev registering their
    // localhost receiver by address is not refused by the save while allowed
    // by the send.
    const allowPrivate = privateTargetsAllowed({
      NODE_ENV: this.configService.get<string>('NODE_ENV'),
      WEBHOOK_ALLOW_PRIVATE_TARGETS: this.configService.get<string>(
        'WEBHOOK_ALLOW_PRIVATE_TARGETS',
      ),
    });
    const denied = allowPrivate ? null : deniedLiteral(parsed.hostname);

    if (denied) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `The endpoint host ${denied} is not a public address`,
      });
    }
  }

  /**
   * The three checks the FIELD TYPE cannot make, now that it makes the fourth.
   *
   * `repeated NotificationType` states the vocabulary, which is what removed
   * the membership set and the `as NotificationType[]` that closed this
   * function. What it cannot state is that the list is non-empty, that it holds
   * no duplicates, or that a proto3 enum is OPEN — an int outside the
   * declaration survives the wire and arrives here as `UNRECOGNIZED`, so the
   * unknown check stays and is answered by the bridge rather than by a second
   * copy of the vocabulary.
   */
  private assertEventTypes(
    types: readonly ProtoNotificationType[],
  ): NotificationType[] {
    // **Zero types is refused at creation, never created silently useless** —
    // and an empty list never means "all". Known-gap #25 is what that
    // ambiguity costs from the consuming side.
    if (types.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Subscribe the endpoint to at least one event type',
      });
    }

    const mapped = types.map((type) => ({
      wire: type,
      domain: fromProtoNotificationType(type),
    }));
    const unknown = mapped.filter((entry) => entry.domain === null);

    if (unknown.length > 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Unknown event type(s): ${unknown.map((entry) => entry.wire).join(', ')}`,
      });
    }

    return [
      ...new Set(mapped.map((entry) => entry.domain as NotificationType)),
    ];
  }
}

/** 32 random bytes, hex — unguessable and rotatable, never derived. */
function newSecret(): string {
  return `whsec_${randomBytes(29).toString('hex')}`;
}
