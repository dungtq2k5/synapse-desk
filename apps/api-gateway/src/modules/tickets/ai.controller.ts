import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequestContext } from '@synapsedesk/common';
import {
  AI_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AiService } from './ai.service';
import { GenerateDraftDto } from './dto/rest/ai.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  AiClassificationResponseDto,
  AiDraftResponseDto,
  AiSuggestionsResponseDto,
  AiSummaryResponseDto,
} from './dto/rest/ai-response.dto';

/**
 * The AI co-pilot (api-endpoints-plan §2.3).
 *
 * Every route here answers **503** today — `rag-service` is Python and is not
 * started. The wiring is real so Domain C is a service swap, and 503
 * rather than 404-or-nothing is what lets a client tell "not built yet" from
 * "broken" and from "you asked for the wrong thing".
 *
 * The permissions are the part that is fully live: reading a summary is queue
 * access, GENERATING anything is `ticket.ai.use`, which is metered and costs
 * money. Those two must not be the same grant.
 */
@ApiTags('Ai')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('tickets/:ticketId/ai')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  /**
   * Reading a STORED summary costs nothing and needs no model — so it is gated
   * on queue access rather than on the generation permission.
   */
  @ApiOperation({ summary: 'Get summary' })
  @ApiWrappedResponse(AiSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get('summary')
  @RequirePermission('ticket.read.all')
  getSummary(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSummaryResponseDto> {
    return this.ai.getSummary(ticketId, context);
  }

  /**
   * 200, not 201.
   *
   * The summary is a 1:1 upsert — re-generating REPLACES the row rather than
   * creating a second one — so "created" would be a lie on every call after the
   * first, and a client keying off 201 would treat a replacement as a new
   * resource.
   */
  // A per-USER minute limit, on top of the monthly quota. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.aiSummary })
  // 402 on this and the three below: they GENERATE, so they are refused at the
  // AI cap. It travels as `PERMISSION_DENIED` carrying an `[http:402]` marker
  // that the exception filter obeys — undeclared, the spec would say a billing
  // refusal is a permissions problem. `GET summary` above reads a stored row
  // and spends nothing, so it does not carry it.
  @ApiOperation({ summary: 'Generate summary' })
  @ApiWrappedResponse(AiSummaryResponseDto)
  @ApiFilterErrors(['400', '401', '402', '403', '404'])
  @Post('summary')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Summary generated')
  generateSummary(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSummaryResponseDto> {
    return this.ai.generateSummary(ticketId, context);
  }

  /**
   * Returns a draft; persists NOTHING.
   *
   * The agent reads it, edits it and decides. `POST /tickets/:id/messages` with
   * `invokeAi` is the path that does persist, and keeping the two separate is
   * what stops an unreviewed generated reply reaching a customer.
   */
  // A per-USER minute limit, on top of the monthly quota. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.aiDraft })
  @ApiOperation({ summary: 'Generate draft' })
  @ApiWrappedResponse(AiDraftResponseDto)
  @ApiFilterErrors(['400', '401', '402', '403', '404'])
  @Post('draft')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  generateDraft(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: GenerateDraftDto,
  ): Promise<AiDraftResponseDto> {
    return this.ai.generateDraft(ticketId, dto, context);
  }

  // A per-USER minute limit, on top of the monthly quota. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.aiSuggestions })
  @ApiOperation({ summary: 'Get suggestions' })
  @ApiWrappedResponse(AiSuggestionsResponseDto)
  @ApiFilterErrors(['400', '401', '402', '403', '404'])
  @Post('suggestions')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  getSuggestions(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSuggestionsResponseDto> {
    return this.ai.getSuggestions(ticketId, context);
  }

  // A per-USER minute limit, on top of the monthly quota. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.aiClassify })
  @ApiOperation({ summary: 'Classify' })
  @ApiWrappedResponse(AiClassificationResponseDto)
  @ApiFilterErrors(['400', '401', '402', '403', '404'])
  @Post('classify')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  classify(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiClassificationResponseDto> {
    return this.ai.classifyTicket(ticketId, context);
  }
}
