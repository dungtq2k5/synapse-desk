import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  DigestMode,
  NOTIFICATION_TYPE_VALUES,
  NotificationChannel,
  PREFERENCE_CHANNELS,
  PREFERENCE_WILDCARD_TYPE,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import {
  ListPreferencesResponse,
  PreferenceResponse,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { PreferenceResolver } from './preference-resolver.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The settings screen — 18-doc §4, api-endpoints-plan §4b.
 *
 * **Returns the RESOLVED catalogue, not the stored rows.** A settings screen
 * built from stored rows shows a user who has never touched it an empty page,
 * which reads as "notifications are off" — and a user who then toggles
 * something on has no idea what the other twenty entries were doing.
 *
 * Every entry carries `source`, so the UI can say *"inherited"* rather than
 * pretending a default was a choice.
 */
@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PreferenceResolver,
  ) {}

  /**
   * Every (type, channel) pair, resolved.
   *
   * The wildcard row is included as its own entry rather than being folded
   * away: it is the control a user actually reaches for — "stop emailing me
   * about anything" — and hiding it would leave them turning off eighteen
   * switches one at a time.
   */
  async list(context: CallerContext): Promise<ListPreferencesResponse> {
    const userId = requireActor(context);

    const types = [PREFERENCE_WILDCARD_TYPE, ...NOTIFICATION_TYPE_VALUES];
    const items: PreferenceResponse[] = [];

    for (const type of types) {
      for (const channel of PREFERENCE_CHANNELS) {
        const resolved = await this.resolver.resolveOne(userId, type, channel);

        items.push({
          type: resolved.type,
          channel: resolved.channel,
          isEnabled: resolved.isEnabled,
          digest: resolved.digest,
          source: resolved.source,
        });
      }
    }

    return { items };
  }

  /**
   * **Upsert, never insert** — `UNIQUE (user_id, type, channel)`.
   *
   * A settings screen sends the same pair repeatedly (every toggle is a PATCH),
   * so an insert would collide on the second click and a delete-then-insert
   * would lose the row to any error between the two.
   */
  async update(
    request: UpdatePreferenceRequest,
    context: CallerContext,
  ): Promise<PreferenceResponse> {
    const userId = requireActor(context);
    const organizationId = requireTenant(context);

    const type = this.validateType(request.type);
    const channel = this.validateChannel(request.channel);
    const digest = this.validateDigest(request.digest);

    // The `update` half deliberately omits any field the request did not
    // carry, so a PATCH sending only `isEnabled` does not reset `digest` to its
    // default. Overwriting the field it did not mention is the classic PATCH
    // bug, and here it would switch a user off a digest they had chosen.
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId_type_channel: { userId, type, channel } },
      create: {
        userId,
        organizationId,
        type,
        channel,
        isEnabled: request.isEnabled ?? true,
        digest: digest ?? DigestMode.IMMEDIATE,
      },
      update: {
        ...(request.isEnabled === undefined
          ? {}
          : { isEnabled: request.isEnabled }),
        ...(digest ? { digest } : {}),
      },
    });

    return {
      type: row.type,
      channel: row.channel,
      isEnabled: row.isEnabled,
      digest: row.digest,
      // Always `explicit` after a write — that is what a write means, and it
      // is how the UI stops rendering the row as inherited.
      source: 'explicit',
    };
  }

  /**
   * Validated against the known set rather than stored as given.
   *
   * A typo'd type is a preference that silences nothing: the row exists, the
   * user believes they turned something off, and every notification still
   * arrives because nothing ever resolves against that string. Refusing it is
   * the only outcome that tells them.
   */
  private validateType(type: string): string {
    if (
      type === PREFERENCE_WILDCARD_TYPE ||
      (NOTIFICATION_TYPE_VALUES as string[]).includes(type)
    ) {
      return type;
    }

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown notification type '${type}'`,
    });
  }

  private validateChannel(channel: string): NotificationChannel {
    // `WEBHOOK` is deliberately absent from `PREFERENCE_CHANNELS`: it is in the
    // channel enum for completeness and has no implementation (18-doc §8), so
    // a preference for it would be a setting that controls nothing.
    // Compared as STRINGS, because `channel` arrives off the wire and a
    // direct enum comparison would be asserting the very thing being checked.
    const match = PREFERENCE_CHANNELS.find(
      (value) => String(value) === channel,
    );
    if (match) return match;

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown or unsupported channel '${channel}'`,
    });
  }

  private validateDigest(digest: string | undefined): DigestMode | null {
    if (!digest) return null;

    const match = Object.values(DigestMode).find(
      (value) => String(value) === digest,
    );
    if (match) return match;

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown digest mode '${digest}'`,
    });
  }
}
