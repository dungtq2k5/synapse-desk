import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  EmailTemplateName,
  maskPhoneNumber,
  OtpPurpose,
  SmsTemplateName,
} from '@synapsedesk/common';
import {
  fromProtoOtpPurpose,
  OtpStatusRequest,
  OtpStatusResponse,
  RequestEmailVerificationRequest,
  RequestOtpResponse,
  RequestPhoneVerificationRequest,
  toProtoTimestamp,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@synapsedesk/grpc-proto';
import type { Otp } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';
import {
  addMinutes,
  generateNumericCode,
  hashCode,
  maskEmail,
  verifyCode,
} from '../../common/utils';

/**
 * The outcome of checking a code, plus the row it was checked against.
 *
 * Returning both is what lets `verifyPhone` copy `otp.target` onto the user
 * without re-querying — and `otp` is non-optional because `consume` throws
 * rather than returning when nothing is pending.
 */
type ConsumedOtp = {
  response: VerifyOtpResponse;
  otp: Otp;
};

/**
 * Email and phone ownership challenges, backed by the `otps` table.
 *
 * The code is dispatched over NATS to notification-service — this service holds
 * no SMTP or Twilio credentials, and a mail outage must not fail the request
 * that asked for a code.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  private readonly OTP_LENGTH: number;
  private readonly OTP_EXPIRY_MINUTES: number;
  private readonly OTP_MAX_ATTEMPTS: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationPublisher,
  ) {
    this.OTP_LENGTH = this.configService.getOrThrow<number>('OTP_LENGTH');
    this.OTP_EXPIRY_MINUTES =
      this.configService.getOrThrow<number>('OTP_EXPIRY_MINUTES');
    this.OTP_MAX_ATTEMPTS =
      this.configService.getOrThrow<number>('OTP_MAX_ATTEMPTS');
  }

  async requestEmailVerification(
    request: RequestEmailVerificationRequest,
  ): Promise<RequestOtpResponse> {
    const user = await this.loadUser(request.userId);
    if (user.isEmailVerified) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Email address is already verified',
      });
    }

    const code = await this.issue(
      user.id,
      OtpPurpose.EMAIL_VERIFICATION,
      user.email,
    );

    this.notifications.sendEmail({
      template: EmailTemplateName.EMAIL_VERIFICATION,
      to: user.email,
      data: {
        fullName: user.fullName,
        code,
        expiresInMinutes: this.OTP_EXPIRY_MINUTES,
      },
    });

    return {
      target: maskEmail(user.email),
      expiresInMinutes: this.OTP_EXPIRY_MINUTES,
    };
  }

  /**
   * On success the caller should refresh its tokens: `isEmailVerified` is a JWT
   * claim, so an access token issued before verifying still says `false` until
   * it rotates.
   */
  async verifyEmail(request: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    const { response } = await this.consume(
      request,
      OtpPurpose.EMAIL_VERIFICATION,
    );

    // The branch guards the WRITE, not the answer: `consume` has already
    // decided the outcome, and a failed verification returns the same response
    // it would otherwise -- it just must not mark the address verified.
    if (response.verified) {
      await this.prisma.user.update({
        where: { id: request.userId },
        data: { isEmailVerified: true },
      });
    }

    return response;
  }

  /**
   * Serves first-time verification AND change-of-number, because the target
   * travels with the request rather than being read off the user row. Nothing is
   * written to `users.phone_number` until a code for that exact target verifies.
   */
  async requestPhoneVerification(
    request: RequestPhoneVerificationRequest,
  ): Promise<RequestOtpResponse> {
    const user = await this.loadUser(request.userId);

    const code = await this.issue(
      user.id,
      OtpPurpose.PHONE_VERIFICATION,
      request.phoneNumber,
    );

    this.notifications.sendSms({
      template: SmsTemplateName.PHONE_VERIFICATION,
      to: request.phoneNumber,
      data: { code, expiresInMinutes: this.OTP_EXPIRY_MINUTES },
    });

    return {
      target: maskPhoneNumber(request.phoneNumber),
      expiresInMinutes: this.OTP_EXPIRY_MINUTES,
    };
  }

  async verifyPhone(request: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    // One lookup. `consume` loads the row and hands it back, so there is no
    // second query and no `!otp` guard for a case it has already thrown on.
    const { response, otp } = await this.consume(
      request,
      OtpPurpose.PHONE_VERIFICATION,
    );

    // The branch guards the WRITE, not the answer. The target is copied onto
    // the user only on success, which is what makes this endpoint safe to use
    // for CHANGING a number.
    if (response.verified) {
      await this.prisma.user.update({
        where: { id: request.userId },
        data: { phoneNumber: otp.target, isPhoneVerified: true },
      });
    }

    return response;
  }

  /** Drives the resend UI. Never returns `code_hash`. */
  async getOtpStatus(request: OtpStatusRequest): Promise<OtpStatusResponse> {
    // No validation left to do: `purpose` is an enum in the contract now, so
    // protoc rejects anything outside it before this method is reached. The only
    // survivable case is the proto3 zero value, which means the caller omitted
    // the field.
    const purpose = fromProtoOtpPurpose(request.purpose);
    if (!purpose) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'An OTP purpose is required',
      });
    }

    const otp = await this.findPending(request.userId, purpose);
    if (!otp) return { pending: false, attemptsRemaining: 0 };

    return {
      pending: true,
      target:
        purpose === OtpPurpose.PHONE_VERIFICATION
          ? maskPhoneNumber(otp.target)
          : maskEmail(otp.target),
      expiresAt: toProtoTimestamp(otp.expiresAt),
      attemptsRemaining: Math.max(0, otp.maxAttempts - otp.attemptsCount),
    };
  }

  /**
   * Issues a code, burning any earlier outstanding one for the same purpose.
   *
   * Without that invalidation, five "resend" clicks leave five live codes and
   * multiply an attacker's guessing surface by five.
   */
  private async issue(
    userId: string,
    purpose: OtpPurpose,
    target: string,
  ): Promise<string> {
    const code = generateNumericCode(this.OTP_LENGTH);
    // Hashed OUTSIDE the transaction: scrypt is ~40 ms, and 40 ms of a held
    // connection buys nothing when the value does not depend on anything the
    // transaction reads.
    const codeHash = await hashCode(code);

    await this.prisma.$transaction(async (tx) => {
      await tx.otp.updateMany({
        where: { userId, purpose, isUsed: false },
        data: { isUsed: true },
      });

      await tx.otp.create({
        data: {
          userId,
          purpose,
          target,
          // Salted scrypt: the code is fetched by (user, purpose) and then
          // compared, never looked up by hash, so a salt costs nothing here.
          // maxAttempts plus the short expiry remain the ONLINE defence; the
          // slow hash is what a leaked table runs into.
          codeHash,
          maxAttempts: this.OTP_MAX_ATTEMPTS,
          expiresAt: addMinutes(new Date(), this.OTP_EXPIRY_MINUTES),
        },
      });
    });

    return code;
  }

  /**
   * Checks a code and accounts for the attempt.
   *
   * A wrong code increments `attemptsCount`; reaching `maxAttempts` burns the
   * code outright so the client must request a new one. That cap is what makes a
   * 6-digit secret defensible — 10^6 guesses is minutes of scripted traffic
   * otherwise.
   */
  private async consume(
    request: VerifyOtpRequest,
    purpose: OtpPurpose,
  ): Promise<ConsumedOtp> {
    const otp = await this.findPending(request.userId, purpose);

    if (!otp) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'No verification code is pending. Request a new one.',
      });
    }

    if (await verifyCode(request.code, otp.codeHash)) {
      await this.prisma.otp.update({
        where: { id: otp.id },
        data: { isUsed: true },
      });

      return {
        response: {
          verified: true,
          attemptsRemaining: otp.maxAttempts - otp.attemptsCount,
          mustRequestNewCode: false,
        },
        // Returned so the caller can act on what was actually verified —
        // `verifyPhone` needs the target to copy onto the user.
        otp,
      };
    }

    const attemptsCount = otp.attemptsCount + 1;
    const exhausted = attemptsCount >= otp.maxAttempts;

    await this.prisma.otp.update({
      where: { id: otp.id },
      data: { attemptsCount, isUsed: exhausted },
    });

    if (exhausted) {
      this.logger.warn(
        `OTP attempts exhausted for user ${request.userId} (${purpose})`,
      );
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: 'Too many incorrect attempts. Request a new code.',
      });
    }

    return {
      response: {
        verified: false,
        attemptsRemaining: otp.maxAttempts - attemptsCount,
        mustRequestNewCode: false,
      },
      otp,
    };
  }

  private findPending(userId: string, purpose: OtpPurpose) {
    return this.prisma.otp.findFirst({
      where: {
        userId,
        purpose,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async loadUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        isEmailVerified: true,
      },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    return user;
  }
}
