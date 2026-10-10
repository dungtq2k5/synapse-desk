import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DevicePlatform } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Where a person's push notifications go.
 *
 * One row per app install, keyed by the FCM token itself — see the schema
 * docblock for why `token` is unique rather than `(userId, token)`.
 */
@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register or refresh one device.
   *
   * **An upsert on `token`, which handles both cases that look like duplicates
   * and are not**: the same install re-registering after an app restart, and a
   * token FCM has reassigned to a different account on a shared device. The
   * second is why `userId` is overwritten rather than matched on — a tablet two
   * people sign into must not deliver one person's notifications to the other.
   */
  async register(input: {
    userId: string;
    organizationId: string;
    token: string;
    platform: DevicePlatform;
    deviceName?: string;
  }) {
    return this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        organizationId: input.organizationId,
        token: input.token,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
      },
      update: {
        userId: input.userId,
        organizationId: input.organizationId,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
      },
    });
  }

  /** This user's devices, for the settings screen and for the fan-out. */
  listForUser(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Forget one device, BY ROW ID.
   *
   * Not by token: a user signing out on a phone they have lost cannot produce
   * that device's token, and the settings screen lists rows. Scoped to the
   * caller's own `userId`, and a miss is `NOT_FOUND` rather than
   * `PERMISSION_DENIED` — the same rule as every other by-id route, so this
   * cannot be used as an existence oracle across users.
   */
  async remove(id: string, userId: string): Promise<void> {
    const deleted = await this.prisma.deviceToken.deleteMany({
      where: { id, userId },
    });

    if (deleted.count === 0) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No such device',
      });
    }
  }

  /** Touched after a successful send, so the settings list can show staleness. */
  async markUsed(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    await this.prisma.deviceToken.updateMany({
      where: { token: { in: tokens } },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Delete tokens FCM has told us are dead.
   *
   * **The only place this system destroys a stored credential because a third
   * party said so**, which is why the caller decides what counts as dead from a
   * narrow list of codes rather than from "the send failed". A broad
   * catch-and-delete turns an FCM outage into every user silently losing push,
   * with no error and no way back except reinstalling the app.
   */
  async prune(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;

    const { count } = await this.prisma.deviceToken.deleteMany({
      where: { token: { in: tokens } },
    });

    if (count > 0) {
      this.logger.log(`Pruned ${count} dead device token(s)`);
    }

    return count;
  }
}
