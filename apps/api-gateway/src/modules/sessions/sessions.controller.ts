import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContext, OrgAccess } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { JwtCookieService } from '../auth/jwt-cookie.service';
import { SessionsGrpcClient } from './sessions-grpc.client';
import {
  RevokeTrustResponseDto,
  SessionResponseDto,
} from './dto/rest/session.dto';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * The caller's own device sessions (api-endpoints-plan).
 *
 * `/auth/sessions` rather than `/users/me/sessions`: these are credentials, and
 * they sit beside `/auth/logout` which does the same job for one session.
 *
 * The refresh token is read from the COOKIE, never from a body or query. It is
 * used only to identify which session is `current` — the authorization comes
 * from `JwtAuthGuard`, so a caller whose refresh cookie has been cleared still
 * sees their list, just with nothing marked current.
 */
@ApiTags('Sessions')
@ApiCookieAuth(AUTH_SCHEMES.access)
@OrgAccessKind(OrgAccess.AUTH)
@Controller('auth/sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(
    private readonly sessionsGrpcClient: SessionsGrpcClient,
    private readonly jwtCookieService: JwtCookieService,
  ) {}

  @ApiOperation({ summary: 'List own sessions' })
  @ApiWrappedResponse(SessionResponseDto, { isArray: true })
  @ApiFilterErrors(['401'])
  @ApiOperation({ summary: 'List own sessions' })
  @ApiWrappedResponse(SessionResponseDto, { isArray: true })
  @ApiFilterErrors(['401'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Req() request: Request,
  ): Promise<SessionResponseDto[]> {
    return this.sessionsGrpcClient.list(
      this.jwtCookieService.readRefreshToken(request),
      context,
    );
  }

  /**
   * Clears "remember this device" across EVERY session, so the next login from
   * any of them is challenged.
   *
   * Declared BEFORE `@Delete(':id')` deliberately. Nest matches routes in
   * declaration order, so the literal must be registered first or `trusted`
   * would be swallowed as an id — and `ParseUUIDPipe` would turn that into a
   * confusing 400 on a perfectly valid request.
   */
  @ApiOperation({ summary: 'Un-trust every device → forces 2FA everywhere' })
  @ApiWrappedResponse(RevokeTrustResponseDto)
  @ApiFilterErrors(['401'])
  @ApiOperation({ summary: 'Un-trust every device → forces 2FA everywhere' })
  @ApiWrappedResponse(RevokeTrustResponseDto)
  @ApiFilterErrors(['401'])
  @Delete('trusted')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Trusted devices cleared')
  revokeAllTrust(
    @CurrentUser() context: RequestContext,
  ): Promise<RevokeTrustResponseDto> {
    return this.sessionsGrpcClient.revokeAllTrust(context);
  }

  /**
   * Ends the whole session FAMILY, not one row — a rotation already in flight
   * would otherwise outlive the revocation.
   *
   * Clears cookies when the target was the caller's own session, so "sign out
   * this device" pressed on that device behaves like a logout.
   */
  @ApiOperation({
    summary:
      'Revoke one session — expires the whole family_id, so a rotation already in flight cannot outlive the revocation',
  })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '404'])
  @ApiOperation({
    summary:
      'Revoke one session — expires the whole family_id, so a rotation already in flight cannot outlive the revocation',
  })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '404'])
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session revoked')
  async revoke(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revokedCount: number }> {
    const result = await this.sessionsGrpcClient.revoke(
      id,
      this.jwtCookieService.readRefreshToken(request),
      context,
    );

    if (result.wasCurrent) {
      this.jwtCookieService.clearSessionCookies(response);
      this.jwtCookieService.clearDeviceTokenCookie(response);
    }

    return { revokedCount: result.revokedCount };
  }

  /**
   * Drops "remember this device" while leaving the session signed in. The next
   * login from that device gets a 2FA prompt again.
   */
  @ApiOperation({
    summary:
      'Drop device trust for one session (clear device_token_hash / trusted_until, is_trusted = false) while leaving it logged in',
  })
  @ApiWrappedResponse(RevokeTrustResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @ApiOperation({
    summary:
      'Drop device trust for one session (clear device_token_hash / trusted_until, is_trusted = false) while leaving it logged in',
  })
  @ApiWrappedResponse(RevokeTrustResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Delete(':id/trust')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Device trust removed')
  revokeTrust(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevokeTrustResponseDto> {
    return this.sessionsGrpcClient.revokeTrust(id, context);
  }
}
