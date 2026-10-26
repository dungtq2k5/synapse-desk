import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CLIENT_ERROR_STACK_KEPT,
  CLIENT_ERROR_USER_AGENT_KEPT,
  OrgAccess,
  type RequestContext,
} from '@synapsedesk/contracts';
import type { Request } from 'express';
import { AuthThrottle } from '../../common/decorators/auth-throttle.decorator';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import { OrgAccessKind } from '../../common/decorators/org-access.decorator';
import {
  AUTH_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { ReportClientErrorDto } from './dto/rest/client-error.dto';

/**
 * Browser errors, as one log line each: WARN, `"event":"client_error"`.
 *
 * Accepted signed in or out (errors before sign-in matter); the user and
 * organization ids are added when a session is present. Nothing is stored,
 * and the line holds only the fields below: the path without its query or
 * fragment, never page text or form values. Rate-limited per address, and the
 * body is capped (`ClientErrorsModule`).
 */
@ApiTags('Client errors')
@AuthThrottle()
@OrgAccessKind(OrgAccess.AUTH)
@Controller('client-errors')
export class ClientErrorsController {
  private readonly logger = new Logger('ClientErrors');

  constructor(private readonly metrics: MetricsRegistry) {}

  @ApiOperation({ summary: 'Report a browser error', security: [] })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400'])
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({
    [AUTH_THROTTLER_TIER]: {
      ...ROUTE_THROTTLE.clientErrors,
      // By address only: a report before sign-in has no session to key on.
      getTracker: (request: Record<string, unknown>) =>
        `ip:${(request as unknown as Request).ip ?? 'unknown'}`,
    },
  })
  @UseGuards(OptionalJwtAuthGuard)
  report(@Body() report: ReportClientErrorDto, @Req() request: Request): void {
    const caller = request.user as RequestContext | undefined;

    this.metrics.clientErrors.inc({ kind: report.kind });
    this.logger.warn(
      JSON.stringify({
        event: 'client_error',
        kind: report.kind,
        message: report.message,
        stack: report.stack?.slice(0, CLIENT_ERROR_STACK_KEPT),
        path: withoutQuery(report.path),
        userAgent: request
          .get('user-agent')
          ?.slice(0, CLIENT_ERROR_USER_AGENT_KEPT),
        buildId: report.buildId,
        userId: caller?.sub,
        organizationId: caller?.organizationId ?? undefined,
      }),
    );
  }
}

/** `/tickets/42?tab=notes#x` → `/tickets/42`. */
export function withoutQuery(path: string): string {
  return path.split(/[?#]/, 1)[0];
}
