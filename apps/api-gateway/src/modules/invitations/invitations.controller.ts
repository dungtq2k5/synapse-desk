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
import { OrgAccess, RequestContext, RequestOrigin } from '@synapsedesk/common';
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
  PreviewInvitationsDto,
  PreviewInvitationsResponseDto,
} from './dto/rest/invitation.dto';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { LoginResponseDto } from '../auth/dto/rest/login.dto';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';

/**
 * Invitations (api-endpoints-plan).
 *
 * The tenant is ALWAYS the caller's own — `context.organizationId`, never a
 * body or path value — so an admin cannot invite into someone else's workspace.
 * The two public routes are the exception and carry no tenant at all: the token
 * itself names it.
 */
@ApiTags('Invitations')
@ApiCookieAuth(AUTH_SCHEMES.access)
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
  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(CreateInvitationsResponseDto, {
    status: HttpStatus.CREATED,
  })
  @ApiFilterErrors(['400', '401', '403'])
  @ApiOperation({ summary: 'Create' })
  @ApiWrappedResponse(CreateInvitationsResponseDto, {
    status: HttpStatus.CREATED,
  })
  @ApiFilterErrors(['400', '401', '403'])
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

  @ApiOperation({ summary: 'List invitations' })
  @ApiWrappedResponse(Paginated(InvitationResponseDto))
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'List invitations' })
  @ApiWrappedResponse(Paginated(InvitationResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user.read')
  async list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListInvitationsQueryDto,
  ): Promise<PaginationResponseBase<InvitationResponseDto>> {
    // The envelope is built by the SERVICE now, via the shared PageMeta —
    // this used to recompute it here from `totalItems`, which meant the page
    // maths existed twice and only one copy honoured the service-side clamp.
    return this.invitationsGrpcClient.list(
      context.organizationId!,
      query,
      context,
    );
  }

  /** Rotates the token — the previous link stops working immediately. */
  @AuthThrottle()
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.invitationResend })
  @ApiOperation({ summary: 'Resend' })
  @ApiWrappedResponse(InvitationResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @ApiOperation({ summary: 'Resend' })
  @ApiWrappedResponse(InvitationResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
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

  @ApiOperation({ summary: 'Revoke' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @ApiOperation({ summary: 'Revoke' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
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
   * Mounted at `token/:token`, NOT `:token`. The bare form is indistinguishable
   * from `:id` below, and Nest matches in declaration order — so whichever were
   * registered first would swallow the other, and an admin fetching a perfectly
   * valid invitation id would get a 410 that looks like a data problem.
   *
   * No guard: the recipient has no account yet, which is the entire point.
   * It discloses organization and inviter name, so a token-guessing attacker
   * would otherwise learn the customer list — the 32-byte token makes that
   * impractical, and an IP rate limit belongs here once the throttler lands
   * (see the gap noted in the module docblock).
   */
  @AuthThrottle()
  @Throttle({ [AUTH_THROTTLER_TIER]: ROUTE_THROTTLE.invitationPreview })
  @OrgAccessKind(OrgAccess.AUTH)
  @ApiOperation({
    summary: 'Public preview',
    security: [],
  })
  @ApiWrappedResponse(PreviewInvitationResponseDto)
  @ApiFilterErrors(['401', '404'])
  @ApiOperation({
    summary: 'Public preview',
    security: [],
  })
  @ApiWrappedResponse(PreviewInvitationResponseDto)
  @ApiFilterErrors(['401', '404'])
  @Get('token/:token')
  previewByToken(
    @Param('token') token: string,
    @CurrentOrigin() origin: RequestOrigin,
  ): Promise<PreviewInvitationResponseDto> {
    return this.invitationsGrpcClient.previewByToken(token, origin);
  }

  /**
   * Redeems the invitation and signs the invitee straight in — no separate
   * login step, and no email verification challenge either: delivery to the
   * address already proved ownership.
   *
   * `GuestGuard` for the same reason `/auth/login` has it: accepting while
   * already signed in would silently replace the current session.
   */
  @OrgAccessKind(OrgAccess.AUTH)
  @ApiOperation({
    summary: 'Redeem',
    security: [],
  })
  @ApiWrappedResponse(LoginResponseDto)
  @ApiFilterErrors(['400', '401'])
  @ApiOperation({
    summary: 'Redeem',
    security: [],
  })
  @ApiWrappedResponse(LoginResponseDto)
  @ApiFilterErrors(['400', '401'])
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
  /**
   * Dry run over a batch: no writes, no mail.
   *
   * `EmailVerifiedGuard` is deliberately ABSENT, unlike `POST /users/invitations`
   * — nothing is sent, so the reason that gate exists (an unproven address
   * spraying invitations) does not apply to a validation call.
   */
  @ApiOperation({
    summary:
      'Dry-run a list before sending: flags addresses already in this tenant, malformed addresses, unknown role/department ids, and projected seat overrun',
  })
  @ApiWrappedResponse(PreviewInvitationsResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @ApiOperation({
    summary:
      'Dry-run a list before sending: flags addresses already in this tenant, malformed addresses, unknown role/department ids, and projected seat overrun',
  })
  @ApiWrappedResponse(PreviewInvitationsResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user.invite')
  previewBatch(
    @CurrentUser() context: RequestContext,
    @Body() previewInvitationsDto: PreviewInvitationsDto,
  ): Promise<PreviewInvitationsResponseDto> {
    return this.invitationsGrpcClient.previewBatch(
      context.organizationId!,
      previewInvitationsDto,
      context,
    );
  }

  /**
   * Administrative detail by id, in ANY status — an admin asking "what happened
   * to that invite?" needs the revoked and expired ones too.
   *
   * Declared AFTER `token/:token` and `preview`, so those literals win.
   */
  @ApiOperation({ summary: 'Single invitation detail incl' })
  @ApiWrappedResponse(InvitationResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @ApiOperation({ summary: 'Single invitation detail incl' })
  @ApiWrappedResponse(InvitationResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('user.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationResponseDto> {
    return this.invitationsGrpcClient.get(context.organizationId!, id, context);
  }
}
