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
  PreferenceSource,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import {
  DigestMode as ProtoDigestMode,
  fromProtoDigestMode,
  fromProtoNotificationChannel,
  ListPreferencesResponse,
  NotificationChannel as ProtoNotificationChannel,
  PreferenceResponse,
  toProtoDigestMode,
  toProtoNotificationChannel,
  toProtoPreferenceSource,
  UpdatePreferenceRequest,
} from '@synapsedesk/grpc-proto';
import { PreferenceResolver } from './preference-resolver.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The settings screen, api-endpoints-plan §4b.
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
          channel: toProtoNotificationChannel(resolved.channel),
          isEnabled: resolved.isEnabled,
          digest: toProtoDigestMode(resolved.digest),
          source: toProtoPreferenceSource(resolved.source),
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
      // Both columns are Postgres `VarChar`, so these are plain strings
      // on the way out of Prisma and the mappers take them as such.
      type: row.type,
      channel: toProtoNotificationChannel(row.channel),
      isEnabled: row.isEnabled,
      digest: toProtoDigestMode(row.digest),
      // Always `explicit` after a write — that is what a write means, and it
      // is how the UI stops rendering the row as inherited.
      source: toProtoPreferenceSource(PreferenceSource.EXPLICIT),
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

  /**
   * Rejects a channel that is not a configurable PREFERENCE.
   *
   * The proto enum already answers "is this a channel at all?" before any
   * handler runs, so an unknown channel never reaches here.
   *
   * What remains is a POLICY no wire type can express: `WEBHOOK` is a real
   * channel with no implementation, so a preference for it would be a setting
   * that controls nothing.
   *
   * `UNSPECIFIED` lands here too — a caller that omitted the field — and gets
   * the same refusal, because a write has to know which channel it is writing.
   */
  private validateChannel(
    channel: ProtoNotificationChannel,
  ): NotificationChannel {
    const domain = fromProtoNotificationChannel(channel);
    const match = PREFERENCE_CHANNELS.find((value) => value === domain);
    if (match) return match;

    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: `Unknown or unsupported channel '${ProtoNotificationChannel[channel] ?? channel}'`,
    });
  }

  /**
   * No validation left to do — only the absent/present distinction.
   *
   * `UNSPECIFIED` is proto3's "the client did not send one", which is exactly
   * what the PATCH needs: a request that omits `digest` must leave a chosen
   * digest alone rather than resetting it. Every other value is one the wire
   * already guaranteed is a member.
   */
  private validateDigest(digest: ProtoDigestMode): DigestMode | null {
    return fromProtoDigestMode(digest);
  }
}
