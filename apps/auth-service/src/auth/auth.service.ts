import { Injectable } from '@nestjs/common';
import {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  TwoFactorLoginResponse,
} from '@synapsedesk/grpc-proto';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { extractEmailDomain, OrgStatus } from '@synapsedesk/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { JwtPayload, TwoFactorJwtPayload } from '../config/app.config';
import { ConfigService } from '@nestjs/config';
import { generateUniqueOrganizationSlug } from '../utils/utils';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

@Injectable()
export class AuthService {
  private readonly JWT_2FA_SECRET: string;
  private readonly JWT_2FA_EXPIRES_IN: string;

  constructor(
    // Must be PrismaService, not PrismaClient: PrismaModule provides it under
    // the PrismaService token, and only PrismaService wires up connect/disconnect.
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.JWT_2FA_SECRET =
      this.configService.getOrThrow<string>('JWT_2FA_SECRET');
    this.JWT_2FA_EXPIRES_IN =
      this.configService.getOrThrow<string>('JWT_2FA_EXPIRES_IN');
  }

  /**
   * Register a new user, Auto-joins tenant if email domain matches allowed_email_domains.
   * Otherwise, creates a PENDING_ONBOARDING organization.
   */
  async register(registerRequest: RegisterRequest): Promise<RegisterResponse> {
    /**
     * Business logic:
     * 1. Check if user already exists via email
     * 2. Determine organization: find by domain or create pending org
     * 3. Create user with hashed password, isEmailVerified = false, organization
     * 4. Assign end user role
     */
    const { email, password, fullName } = registerRequest;

    // TODO Since we only check the existence of user so is there a optimize for this?
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      // TODO Need to handle email bombing attack?
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'Email already registered',
      });
    }

    const emailDomain = extractEmailDomain(email);
    if (!emailDomain) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Email is not valid',
      });
    }

    let org = await this.prisma.organization.findFirst({
      where: {
        allowedEmailDomains: { has: emailDomain },
      },
    });
    if (!org) {
      // TODO Handle transaction when org is created but user create fail
      org = await this.prisma.organization.create({
        data: {
          name: `Workspace for ${email}`,
          slug: generateUniqueOrganizationSlug(email),
          status: OrgStatus.PENDING_ONBOARDING,
          allowedEmailDomains: [emailDomain],
        },
      });
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        fullName,
        email,
        passwordHash: await bcrypt.hash(
          password,
          this.configService.getOrThrow('BCRYPT_ROUNDS'),
        ),
        isEmailVerified: false,
      },
      include: { organization: true }, // TODO Why we need to include organization since we only return user data?
    });

    // TODO Create system roles and assign to register user

    return {
      userId: user.id,
      email: user.email,
      organizationId: user.organizationId || org.id,
      requiresEmailVerification: true,
    };
  }

  /**
   * Login with email + password. Returns tokens and optional 2FA challenge.
   */
  async login(
    loginRequest: LoginRequest,
  ): Promise<LoginResponse | TwoFactorLoginResponse> {
    // TODO Handle login with device_sessions
    const { email, password, deviceName } = loginRequest;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });
    if (!user) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    // TODO Should we add the condition check if user.passwordHash is null -> login with third-party service -> return invalid credentials directly from this endpoint
    const isPasswordValid = await bcrypt.compare(
      password,
      user.passwordHash || '',
    );
    if (!isPasswordValid) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    if (user.isLocked) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Account is locked',
      });
    }

    if (user.organization?.status === OrgStatus.FROZEN) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Organization access temporarily disabled',
      });
    }

    const enforces2fa =
      user.isTwoFactorEnabled ?? user.organization?.enforceTwoFactor;
    if (enforces2fa) {
      // TODO Check if device is trusted with device_sessions -> to decide return direct tokens or return 2FA challenge
      const twoFactorToken = this.generate2faToken(user.id);

      return {
        twoFactorToken,
        requiresTwoFactor: true,
      };
    }

    // TODO Implement logic to generate access_token + refresh_token (store hash) within device_sessions
  }

  // TODO resetPassword

  private generateAccessToken(userId: string, email: string): string {
    // TTL is set at AuthModule -> no need to set it here
    // If set the TTL here, it will override the TTL set at AuthModule
    return this.jwtService.sign({
      sub: userId,
      email,
    } satisfies JwtPayload);
  }

  private generate2faToken(userId: string): string {
    return this.jwtService.sign(
      {
        sub: userId,
        is2faPending: true,
      } satisfies TwoFactorJwtPayload,
      {
        secret: this.JWT_2FA_SECRET,
        expiresIn: this.JWT_2FA_EXPIRES_IN,
      } as JwtSignOptions,
    );
  }
}
