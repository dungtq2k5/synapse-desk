import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { SessionsService } from './sessions.service';
import { SessionResponseDto } from './dto/rest/session-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * Administrative views of ANOTHER user's sessions.
 *
 * Split from `SessionsController` into its own file (same module): the path is
 * different (`/users/:userId/...`) and so is the authorization — this needs
 * explicit permissions, while everything on `/auth/sessions` is authorized by
 * owning the session. Nesting under `/users/...` does NOT move it into the
 * `users` module — same precedent as `invitations.controller.ts`, which is
 * `@Controller('users/invitations')` while living in `invitations/`. Ownership
 * follows the resource (and its gRPC client), not the URL prefix.
 */
@ApiTags('User Sessions')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('users/:userId/sessions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UserSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @ApiOperation({ summary: 'List invitations' })
  @ApiWrappedResponse(SessionResponseDto, { isArray: true })
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get()
  @RequirePermission('user.session.read')
  list(
    @CurrentUser() context: RequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SessionResponseDto[]> {
    return this.sessions.listForUser(userId, context);
  }

  /**
   * Force-logout for incident response. Takes device trust with it, and emails
   * the target — being signed out by an administrator is something they should
   * hear from us rather than infer.
   */
  @ApiOperation({ summary: 'Revoke' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Delete()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.session.revoke')
  @ResponseMessage('Sessions revoked')
  revoke(
    @CurrentUser() context: RequestContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ revokedCount: number }> {
    return this.sessions.revokeForUser(userId, context);
  }
}
