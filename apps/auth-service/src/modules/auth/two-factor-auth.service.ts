import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateSecret, generateURI, verify } from 'otplib';
import { toDataURL } from 'qrcode';
import * as bcrypt from 'bcrypt';
import {
  ActivateTwoFactorRequest,
  ActivateTwoFactorResponse,
  AuthenticateTwoFactorRequest,
  AuthenticateTwoFactorResponse,
  BackupCodesStatusRequest,
  BackupCodesStatusResponse,
  DisableTwoFactorRequest,
  DisableTwoFactorResponse,
  GenerateTwoFactorRequest,
  GenerateTwoFactorResponse,
  RegenerateBackupCodesRequest,
  RegenerateBackupCodesResponse,
  toTimestamp,
} from '@synapsedesk/grpc-proto';
import {
  EmailTemplateName,
  RequestOrigin,
  UNKNOWN_ORIGIN,
  type TwoFactorJwtPayload,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import {
  addDays,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  hashToken,
  normalizeBackupCode,
  safeCompareHex,
} from '../../common/utils/utils';

/**
 * TOTP enrolment, verification and backup codes.
 *
 * Split from AuthService rather than bolted onto it because 2FA is a distinct
 * lifecycle — enrol, activate, challenge, recover, disable — that meets
 * AuthService at exactly one point: issuing the real session once a challenge
 * passes.
 */
@Injectable()
export class TwoFactorAuthService {
  private readonly logger = new Logger(TwoFactorAuthService.name);

  private readonly MASTER_KEY: string;
  private readonly APP_NAME: string;
  private readonly TIME_TOLERANCE: number;
  private readonly BACKUP_CODES_PER_USER: number;
  private readonly BACKUP_CODES_LOW_THRESHOLD: number;
  private readonly BACKUP_CODE_TTL_DAYS: number;
  /**
   * Derived from the 2FA private key rather than read from a second file.
   *
   * This service signs the challenge token, so it must also verify it — and
   * RS256 verification needs the public half. Deriving it means one path to
   * configure and no way to end up holding a mismatched pair.
   */
  private readonly JWT_2FA_PUBLIC_KEY: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationPublisher,
  ) {
    this.MASTER_KEY = this.configService.getOrThrow<string>(
      'TWO_FACTOR_MASTER_KEY',
    );
    this.APP_NAME = this.configService.getOrThrow<string>('APP_NAME');
    this.TIME_TOLERANCE = this.configService.getOrThrow<number>(
      'TWO_FACTOR_TIME_TOLERANCE',
    );
    this.BACKUP_CODES_PER_USER = this.configService.getOrThrow<number>(
      'BACKUP_CODES_PER_USER',
    );
    this.BACKUP_CODES_LOW_THRESHOLD = this.configService.getOrThrow<number>(
      'BACKUP_CODES_LOW_WARNING_THRESHOLD',
    );
    this.BACKUP_CODE_TTL_DAYS = this.configService.getOrThrow<number>(
      'BACKUP_CODE_TTL_DAYS',
    );
    this.JWT_2FA_PUBLIC_KEY = createPublicKey(
      readFileSync(
        this.configService.getOrThrow<string>('JWT_2FA_PRIVATE_KEY_PATH'),
      ),
    )
      .export({ type: 'spki', format: 'pem' })
      .toString();
  }

  /**
   * Step 1 of enrolment: mint a secret and hand back something to scan.
   *
   * `isTwoFactorEnabled` stays false. A secret that exists but has not been
   * confirmed must not gate logins — otherwise a user who closes the tab before
   * scanning the QR code locks themselves out permanently.
   */
  async generateTwoFactor(
    request: GenerateTwoFactorRequest,
  ): Promise<GenerateTwoFactorResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId, deletedAt: null },
      select: { email: true, isTwoFactorEnabled: true },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (user.isTwoFactorEnabled) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor authentication is already enabled',
      });
    }

    const secret = generateSecret();
    const otpauthUri = generateURI({
      issuer: this.APP_NAME,
      label: user.email,
      secret,
    });

    await this.prisma.user.update({
      where: { id: request.userId },
      data: {
        // Encrypted, not hashed: a TOTP secret has to be readable to verify a
        // code against it. See encryptSecret().
        twoFactorSecret: encryptSecret(secret, this.MASTER_KEY),
        isTwoFactorEnabled: false,
      },
    });

    return {
      otpauthUri,
      qrCodeDataUrl: await toDataURL(otpauthUri),
    };
  }

  /**
   * Step 2 of enrolment: prove the authenticator works, then switch 2FA on and
   * return the backup codes.
   *
   * Requiring a valid code before enabling is what stops a mis-scanned QR from
   * becoming a locked-out account.
   */
  async activateTwoFactor(
    request: ActivateTwoFactorRequest,
  ): Promise<ActivateTwoFactorResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        isTwoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (user.isTwoFactorEnabled) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor authentication is already enabled',
      });
    }
    if (!user.twoFactorSecret) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor setup has not been started for this account',
      });
    }

    if (!(await this.verifyTotp(user.twoFactorSecret, request.code))) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid authentication code',
      });
    }

    const backupCodes = await this.replaceBackupCodes(user.id, true);

    // Every change to a second factor is emailed, unconditionally. If an
    // attacker with a live session enrols THEIR authenticator, this message is
    // the only signal the real owner gets.
    this.alert(
      user,
      'Two-factor authentication enabled',
      'Two-factor authentication is now switched on for your account. You will be asked for a code from your authenticator app the next time you sign in.',
    );

    return { backupCodes };
  }

  /**
   * The second leg of login: exchange the short-lived 2FA token for a real
   * session.
   *
   * This is the ONLY place a device token is minted. Trust is granted after a
   * passed challenge and explicit consent, never as a side effect of logging
   * in — which is exactly what makes the `isTrustedDevice` shortcut in
   * `AuthService.login` safe to rely on.
   */
  async authenticateTwoFactor(
    request: AuthenticateTwoFactorRequest,
    origin: RequestOrigin,
  ): Promise<AuthenticateTwoFactorResponse> {
    const userId = this.verifyTwoFactorToken(request.twoFactorToken);
    const user = await this.authService.loadUserForAuth(userId);

    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor authentication is not enabled for this account',
      });
    }
    if (user.isLocked) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Account is locked',
      });
    }

    let warning: string | undefined;

    if (request.code) {
      if (!(await this.verifyTotp(user.twoFactorSecret, request.code))) {
        throw new RpcException({
          code: status.UNAUTHENTICATED,
          message: 'Invalid verification code',
        });
      }
    } else if (request.backupCode) {
      const remaining = await this.consumeBackupCode(
        user.id,
        request.backupCode,
      );
      if (remaining <= this.BACKUP_CODES_LOW_THRESHOLD) {
        warning =
          `You have ${remaining} backup code(s) left. ` +
          'Regenerate a new set soon.';
      }

      // Signing in with a backup code rather than the authenticator usually
      // means the device was lost — or that someone else has the codes.
      this.alert(
        user,
        'Signed in with a backup code',
        `A backup code was used to sign in to your account. ${remaining} code(s) remain.`,
        origin,
      );
    } else {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A verification code or a backup code is required',
      });
    }

    const session = await this.authService.issueSession(user, {
      name: request.deviceName,
      ...origin,
    });

    const deviceToken = request.rememberDevice
      ? await this.authService.trustDevice(user.id, session.sessionId)
      : undefined;

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: session.user,
      deviceToken,
      warning,
    };
  }

  /**
   * Turn 2FA off. Requires a current TOTP code AND the account password
   * (api-endpoints-plan §1.2): one proves possession of the authenticator, the
   * other proves the person at the keyboard owns the account, so a hijacked
   * session alone cannot strip the second factor.
   */
  async disableTwoFactor(
    request: DisableTwoFactorRequest,
  ): Promise<DisableTwoFactorResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        isTwoFactorEnabled: true,
        twoFactorSecret: true,
        passwordHash: true,
        organization: { select: { enforceTwoFactor: true } },
      },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor authentication is not enabled',
      });
    }
    // A tenant that mandates 2FA outranks the individual's preference.
    if (user.organization?.enforceTwoFactor) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Your organization requires two-factor authentication',
      });
    }

    await this.assertPassword(user.passwordHash, request.password);

    if (!(await this.verifyTotp(user.twoFactorSecret, request.code))) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid verification code',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { isTwoFactorEnabled: false, twoFactorSecret: null },
      });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId: user.id } });
      // Trusted devices exist only to skip a prompt that no longer happens.
      await tx.deviceSession.updateMany({
        where: { userId: user.id },
        data: { isTrusted: false, deviceTokenHash: null, trustedUntil: null },
      });
    });

    this.alert(
      user,
      'Two-factor authentication disabled',
      'Two-factor authentication has been switched off for your account, and every trusted device has been forgotten. Your account is now protected by your password alone.',
    );

    return {};
  }

  /**
   * Password-gated, because holding a live session is not enough to mint fresh
   * recovery credentials.
   */
  async regenerateBackupCodes(
    request: RegenerateBackupCodesRequest,
  ): Promise<RegenerateBackupCodesResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        isTwoFactorEnabled: true,
        passwordHash: true,
      },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (!user.isTwoFactorEnabled) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Two-factor authentication is not enabled',
      });
    }

    await this.assertPassword(user.passwordHash, request.password);

    const backupCodes = await this.replaceBackupCodes(user.id, false);

    this.alert(
      user,
      'Two-factor backup codes regenerated',
      'A new set of backup codes was generated for your account. Every previously issued code has stopped working.',
    );

    return { backupCodes };
  }

  /** Counts only — never hashes, never plaintext. */
  async getBackupCodesStatus(
    request: BackupCodesStatusRequest,
  ): Promise<BackupCodesStatusResponse> {
    const codes = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId: request.userId },
      select: { isUsed: true, expiresAt: true },
    });

    const live = codes.filter((c) => !c.isUsed && c.expiresAt > new Date());

    return {
      remaining: live.length,
      used: codes.filter((c) => c.isUsed).length,
      expiresAt: toTimestamp(live[0]?.expiresAt ?? null),
    };
  }

  /**
   * Replaces the whole set atomically, optionally flipping 2FA on in the same
   * transaction so an account can never end up enabled with zero recovery
   * codes.
   */
  private async replaceBackupCodes(
    userId: string,
    enableTwoFactor: boolean,
  ): Promise<string[]> {
    const rawCodes = generateBackupCodes(this.BACKUP_CODES_PER_USER);
    const expiresAt = addDays(new Date(), this.BACKUP_CODE_TTL_DAYS);

    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.createMany({
        data: rawCodes.map((code) => ({
          userId,
          // SHA-256, not bcrypt: verification has to find a code by value
          // across the set, and a randomly-salted hash would force a bcrypt
          // compare against every row on every attempt. These are ~50 bits
          // from a CSPRNG, so slowing an attacker down buys nothing.
          codeHash: hashToken(normalizeBackupCode(code)),
          expiresAt,
        })),
      });

      if (enableTwoFactor) {
        await tx.user.update({
          where: { id: userId },
          data: { isTwoFactorEnabled: true },
        });
      }
    });

    return rawCodes;
  }

  /**
   * Burns a backup code and returns how many remain.
   *
   * Marked used rather than deleted, so "already used" stays distinguishable
   * from "never existed" in the audit trail.
   */
  private async consumeBackupCode(
    userId: string,
    candidate: string,
  ): Promise<number> {
    const candidateHash = hashToken(normalizeBackupCode(candidate));

    const codes = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId, isUsed: false, expiresAt: { gt: new Date() } },
      select: { id: true, codeHash: true },
    });

    const match = codes.find((code) =>
      safeCompareHex(code.codeHash, candidateHash),
    );
    if (!match) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid backup code',
      });
    }

    await this.prisma.twoFactorBackupCode.update({
      where: { id: match.id },
      data: { isUsed: true },
    });

    return codes.length - 1;
  }

  /**
   * The 2FA token is a JWT signed with its own secret and a short TTL, so a
   * half-finished login cannot be resumed hours later.
   */
  private verifyTwoFactorToken(token: string): string {
    try {
      const payload = this.jwtService.verify<TwoFactorJwtPayload>(token, {
        publicKey: this.JWT_2FA_PUBLIC_KEY,
        algorithms: ['RS256'],
      });
      if (!payload.is2faPending) throw new Error('Not a 2FA token');

      return payload.sub;
    } catch {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Two-factor session is invalid or has expired',
      });
    }
  }

  /**
   * `epochTolerance` accepts codes from adjacent time steps, because a phone's
   * clock is never exactly the server's. Every step of slack widens the window
   * an intercepted code stays valid in, so it is configurable rather than
   * generous by default.
   */
  private async verifyTotp(
    encryptedSecret: string,
    code: string,
  ): Promise<boolean> {
    try {
      const result = await verify({
        token: code,
        secret: decryptSecret(encryptedSecret, this.MASTER_KEY),
        epochTolerance: this.TIME_TOLERANCE,
      });

      return result.valid;
    } catch (error) {
      // A malformed ciphertext means the master key rotated without a
      // re-encryption migration — operationally important, not a user error.
      this.logger.error(
        `Failed to verify TOTP code: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Fire-and-forget security notification.
   *
   * `origin` is optional because most of these fire from an already
   * authenticated session, where the interesting question is "did you do this?"
   * rather than "from where?" — the login path passes it because there the
   * device is the point.
   *
   * The default is the shared frozen UNKNOWN_ORIGIN rather than an inline
   * literal: a literal default allocates a fresh object on every call that omits
   * the argument, and — worse — is mutable, so a callee could scribble on what
   * reads like a constant.
   */
  private alert(
    user: { email: string; fullName: string },
    headline: string,
    detail: string,
    origin: RequestOrigin = UNKNOWN_ORIGIN,
  ): void {
    this.notifications.sendEmail({
      template: EmailTemplateName.SECURITY_ALERT,
      to: user.email,
      data: { fullName: user.fullName, headline, detail, origin },
    });
  }

  private async assertPassword(
    passwordHash: string | null,
    password: string,
  ): Promise<void> {
    // OAuth-only accounts have no password, so these routes are simply not
    // available to them.
    if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }
  }
}
