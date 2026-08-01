import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContext, RequestOrigin } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { GuestGuard } from '../../common/guards/guest.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrigin } from '../../common/decorators/current-origin.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { JwtCookieService } from '../auth/jwt-cookie.service';
import { InvitationsGrpcClient } from './invitations-grpc.client';
import {
  AcceptInvitationDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationResponseDto,
  ListInvitationsQueryDto,
  PreviewInvitationResponseDto,
} from './dto/rest/invitation.dto';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { LoginResponseDto } from '../auth/dto/rest/login.dto';

/**
 * Invitations (api-endpoints-plan §1.1).
 *
 * The tenant is ALWAYS the caller's own — `context.organizationId`, never a
 * body or path value — so an admin cannot invite into someone else's workspace.
 * The two public routes are the exception and carry no tenant at all: the token
 * itself names it.
 */
@Controller('users/invitations')
export class InvitationsController {
  constructor(
    private readonly invitationsGrpcClient: InvitationsGrpcClient,
    private readonly jwtCookieService: JwtCookieService,
  ) {}

  /**
   * Invite one or many. Returns **207** when any address failed, so a single
   * typo in a large paste does not discard the rest.
   *
   * `EmailVerifiedGuard` because this sends mail on the tenant's behalf — an
   * unverified inviter would let an unproven address spray invitations.
   */
  @Post()
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PermissionGuard)
  @RequirePermission('user.invite')
  async create(
    @CurrentUser() context: RequestContext,
    @Body() createInvitationsDto: CreateInvitationsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateInvitationsResponseDto> {
    const result = await this.invitationsGrpcClient.create(
      context.organizationId!,
      context.sub,
      createInvitationsDto,
      context,
    );

    if (result.failed.length > 0) {
      // 207: partial success is the honest status. A 201 would hide the
      // failures and a 400 would imply nothing was created.
      response.status(HttpStatus.MULTI_STATUS);
      response.locals.warning = `${result.failed.length} invitation(s) could not be created`;
    }

    return result;
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user.read')
  async list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListInvitationsQueryDto,
  ): Promise<PaginationResponseBase<InvitationResponseDto>> {
    const { items, totalItems } = await this.invitationsGrpcClient.list(
      context.organizationId!,
      query,
      context,
    );

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: query.limit,
        totalPages: Math.ceil(totalItems / query.limit),
        currentPage: query.page,
      },
    };
  }

  /** Rotates the token — the previous link stops working immediately. */
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard, PermissionGuard)
  @RequirePermission('user.invite')
  @ResponseMessage('Invitation resent')
  resend(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationResponseDto> {
    return this.invitationsGrpcClient.resend(
      context.organizationId!,
      id,
      context.sub,
      context,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user.invite')
  @ResponseMessage('Invitation revoked')
  revoke(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.invitationsGrpcClient.revoke(
      context.organizationId!,
      id,
      context.sub,
      context,
    );
  }

  /**
   * PUBLIC preview, so the invitee sees who invited them before signing up.
   *
   * No guard: the recipient has no account yet, which is the entire point.
   * It discloses organization and inviter name, so a token-guessing attacker
   * would otherwise learn the customer list — the 32-byte token makes that
   * impractical, and an IP rate limit belongs here once the throttler lands
   * (see the gap noted in the module docblock).
   */
  @Get(':token')
  preview(
    @Param('token') token: string,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<PreviewInvitationResponseDto> {
    return this.invitationsGrpcClient.preview(token, origin);
  }

  /**
   * Redeems the invitation and signs the invitee straight in — no separate
   * login step, and no email verification challenge either: delivery to the
   * address already proved ownership.
   *
   * `GuestGuard` for the same reason `/auth/login` has it: accepting while
   * already signed in would silently replace the current session.
   */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GuestGuard)
  async accept(
    @Body() acceptInvitationDto: AcceptInvitationDto,
    @CurrentOrigin() origin: RequestOrigin,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.invitationsGrpcClient.accept(
      acceptInvitationDto,
      origin,
    );

    this.jwtCookieService.setAccessTokenCookie(response, result.accessToken);
    this.jwtCookieService.setRefreshTokenCookie(response, result.refreshToken);

    if (result.skipped.length > 0) {
      // Roles or departments deleted during the invitation window. Surfaced as
      // a warning rather than an error — the acceptance itself succeeded.
      response.locals.warning = `${result.skipped.length} role/department assignment(s) no longer exist and were skipped`;
    }

    return { user: result.user, requiresTwoFactor: false };
  }
}
