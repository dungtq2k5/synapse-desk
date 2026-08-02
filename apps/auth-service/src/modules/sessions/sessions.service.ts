import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CallerContext,
  ListSessionsRequest,
  ListSessionsResponse,
  ListUserSessionsRequest,
  RevokeSessionResponse,
  RevokeTrustResponse,
  RevokeUserSessionsRequest,
  RevokeUserSessionsResponse,
  SessionIdRequest,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditResourceType,
  EmailTemplateName,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import { hashToken } from '../../common/utils/utils';
import { requireActor, tenantScope } from '../../common/utils/tenant-scope';
import { Prisma } from '../../generated/prisma/client';

/**
 * What counts as a session a human would recognise.
 *
 * Spent rotation rows are RETAINED deliberately (RDM §1.5): presenting an
 * already-rotated token is evidence of theft, and deleting the row would make
 * that replay indistinguishable from an unknown token. The cost is that the
 * table holds one row per refresh performed — so any listing that forgets this
 * predicate shows one "device" per refresh, and an active user appears to have
 * hundreds of sessions.
 *
 * Used by every read in this service, without exception.
 */
// A FUNCTION, not a constant: `new Date()` evaluated once at module load would
// freeze "now" at process start, so a long-running service would progressively
// include sessions that have since expired.
//
// Module-scope on purpose, NOT a private class method: it takes no arguments
// and touches no instance state (no `this.prisma`, nothing), so a method would
// tie it to a class instance for zero benefit — every call site would become
// `this.liveSession()` for no added information, and its visibility is already
// exactly what a private method's would be (unexported, file-scoped). Same
// pattern as `emptyPage()` in departments.service.ts.
function liveSession(): Prisma.DeviceSessionWhereInput {
  return { rotatedAt: null, expiresAt: { gt: new Date() } };
}

const SESSION_FIELDS = {
  id: true,
  familyId: true,
  deviceName: true,
  ipAddress: true,
  userAgent: true,
  isTrusted: true,
  trustedUntil: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.DeviceSessionSelect;

type SessionRow = Prisma.DeviceSessionGetPayload<{
  select: typeof SESSION_FIELDS;
}>;

/** All three columns clear together: `isTrusted` alone would leave a live
 * `deviceTokenHash` that `isTrustedDevice()` still matches. */
const UNTRUSTED = {
  deviceTokenHash: null,
  trustedUntil: null,
  isTrusted: false,
} satisfies Prisma.DeviceSessionUpdateManyMutationInput;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly notifications: NotificationPublisher,
  ) {}

  async listSessions(
    request: ListSessionsRequest,
    context: CallerContext,
  ): Promise<ListSessionsResponse> {
    const userId = requireActor(context);
    const currentFamilyId = await this.resolveFamilyId(request.refreshToken);

    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId, ...liveSession() },
      select: SESSION_FIELDS,
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: sessions.map((session) =>
        this.toResponse(session, currentFamilyId),
      ),
    };
  }

  /**
   * Ends the whole FAMILY, not the single row.
   *
   * Revoking one row would let a rotation already in flight outlive the
   * revocation: the successor token was minted from the same family and would
   * still resolve. Family-wide deletion is the only revocation that holds.
   */
  async revokeSession(
    request: SessionIdRequest,
    context: CallerContext,
  ): Promise<RevokeSessionResponse> {
    const userId = requireActor(context);

    // Scoped to the caller: a session id belonging to someone else must 404,
    // not 403 — otherwise the endpoint confirms that the id exists.
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: request.sessionId, userId },
      select: { familyId: true },
    });
    if (!session) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No session with that id',
      });
    }

    // Resolved BEFORE the delete: afterwards the caller's own token no longer
    // matches any row, and the answer would always be "not current".
    const currentFamilyId = await this.resolveFamilyId(request.refreshToken);

    const { count } = await this.prisma.deviceSession.deleteMany({
      where: { familyId: session.familyId },
    });

    return {
      wasCurrent: currentFamilyId === session.familyId,
      revokedCount: count,
    };
  }

  /**
   * Drops device TRUST while leaving the session alive.
   *
   * The user stays signed in on that device; the next login from it gets a 2FA
   * prompt again. Distinct from revoking the session, which signs them out.
   */
  async revokeSessionTrust(
    request: SessionIdRequest,
    context: CallerContext,
  ): Promise<RevokeTrustResponse> {
    const userId = requireActor(context);

    const session = await this.prisma.deviceSession.findFirst({
      where: { id: request.sessionId, userId },
      select: { familyId: true },
    });
    if (!session) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No session with that id',
      });
    }

    const { count } = await this.prisma.deviceSession.updateMany({
      where: { familyId: session.familyId },
      data: UNTRUSTED,
    });

    return { untrustedCount: count };
  }

  async revokeAllTrust(context: CallerContext): Promise<RevokeTrustResponse> {
    const userId = requireActor(context);

    const { count } = await this.prisma.deviceSession.updateMany({
      // Not filtered by `liveSession()`: a spent or expired row can still carry
      // a live `deviceTokenHash`, and trust outlives the session it was granted
      // on by design (30 days vs 7). Missing those rows would leave the trust
      // this endpoint exists to remove.
      where: { userId },
      data: UNTRUSTED,
    });

    return { untrustedCount: count };
  }

  // -------------------------------------------------------------------------
  // Administrative
  // -------------------------------------------------------------------------

  /** `perm:user.session.read`, and the target must be in the caller's tenant. */
  async listUserSessions(
    request: ListUserSessionsRequest,
    context: CallerContext,
  ): Promise<ListSessionsResponse> {
    await this.requireTenantUser(request.userId, context);

    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId: request.userId, ...liveSession() },
      select: SESSION_FIELDS,
      orderBy: { createdAt: 'desc' },
    });

    // `current` is meaningless here: the admin's own refresh token identifies
    // none of the target's families.
    return { items: sessions.map((session) => this.toResponse(session, null)) };
  }

  /**
   * Force-logout for incident response (`perm:user.session.revoke`).
   *
   * Deletes sessions AND trust — leaving `device_token_hash` alive would let
   * the device this exists to cut off skip 2FA on its next login.
   */
  async revokeUserSessions(
    request: RevokeUserSessionsRequest,
    context: CallerContext,
  ): Promise<RevokeUserSessionsResponse> {
    const target = await this.requireTenantUser(request.userId, context);

    const count = await this.revokeAllForUser(request.userId);

    this.audit.record(context, {
      action: AuditAction.USER_SESSIONS_REVOKED,
      resourceType: AuditResourceType.USER,
      resourceId: request.userId,
      metadata: { revokedCount: count },
    });

    // They should learn this from us rather than from being logged out.
    this.notifications.sendEmail({
      template: EmailTemplateName.SECURITY_ALERT,
      to: target.email,
      data: {
        fullName: target.fullName,
        headline: 'Your sessions were ended by an administrator',
        detail: `An administrator signed you out of ${count} device(s). You will need to sign in again.`,
        origin: { ip: context.ip, userAgent: context.userAgent },
      },
    });

    return { revokedCount: count };
  }

  /**
   * Deletes every session for a user, trust included.
   *
   * Shared with `POST /auth/logout/all` and (later) user lock/delete: all three
   * need exactly this, and three copies would eventually disagree about whether
   * trust goes with it.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    // Row DELETION rather than an update, which is what takes device trust with
    // it: `device_token_hash` and `trusted_until` live on these rows, so
    // removing the row is what stops a stolen laptop skipping 2FA.
    const { count } = await this.prisma.deviceSession.deleteMany({
      where: { userId },
    });

    return count;
  }

  /**
   * Every session EXCEPT the caller's own family.
   *
   * Used by `PATCH /auth/password`: the user stays signed in where they are and
   * everyone else is kicked. Falls back to revoking everything when the family
   * cannot be identified — failing closed, because the alternative is leaving
   * an attacker's session alive after a password change.
   */
  async revokeAllExceptFamily(
    userId: string,
    refreshToken: string | undefined,
  ): Promise<number> {
    const familyId = await this.resolveFamilyId(refreshToken);

    const { count } = await this.prisma.deviceSession.deleteMany({
      where: {
        userId,
        ...(familyId ? { familyId: { not: familyId } } : {}),
      },
    });

    return count;
  }

  // -------------------------------------------------------------------------

  /** The family behind a presented refresh token, or null if it resolves none. */
  private async resolveFamilyId(
    refreshToken: string | undefined,
  ): Promise<string | null> {
    if (!refreshToken) return null;

    const session = await this.prisma.deviceSession.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      select: { familyId: true },
    });

    return session?.familyId ?? null;
  }

  /**
   * Resolves the target of an administrative action inside the caller's tenant.
   *
   * `findFirst` with `tenantScope`, never `findUnique({ id })` — the latter
   * cannot express the tenant filter, so it would hand a cross-tenant admin
   * someone else's device list.
   */
  private async requireTenantUser(
    userId: string,
    context: CallerContext,
  ): Promise<{ email: string; fullName: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...tenantScope(context) },
      select: { email: true, fullName: true },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No user with that id',
      });
    }

    return user;
  }

  private toResponse(
    session: SessionRow,
    currentFamilyId: string | null,
  ): ListSessionsResponse['items'][number] {
    return {
      id: session.id,
      deviceName: session.deviceName ?? undefined,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      // Matched by FAMILY, not by IP or user agent: two browsers on one machine
      // share both, and a mobile client's IP changes between requests.
      current: currentFamilyId !== null && session.familyId === currentFamilyId,
      isTrusted: session.isTrusted,
      trustedUntil: toTimestamp(session.trustedUntil),
      expiresAt: toTimestamp(session.expiresAt),
      createdAt: toTimestamp(session.createdAt),
    };
  }
}
