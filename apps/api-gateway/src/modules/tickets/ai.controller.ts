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
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AiGrpcClient } from './ai-grpc.client';
import { GenerateDraftDto } from './dto/rest/ai.dto';
import {
  AiClassificationDto,
  AiDraftResponseDto,
  AiSuggestionDto,
  AiSummaryResponseDto,
} from './dto/rest/ai-response.dto';

/**
 * The AI co-pilot (api-endpoints-plan §2.3).
 *
 * Every route here answers **503** today — `rag-service` is Python and is not
 * started (§1.7). The wiring is real so Domain C is a service swap, and 503
 * rather than 404-or-nothing is what lets a client tell "not built yet" from
 * "broken" and from "you asked for the wrong thing".
 *
 * The permissions are the part that is fully live: reading a summary is queue
 * access, GENERATING anything is `ticket.ai.use`, which is metered and costs
 * money. Those two must not be the same grant.
 */
@Controller('tickets/:ticketId/ai')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AiController {
  constructor(private readonly aiGrpcClient: AiGrpcClient) {}

  /**
   * Reading a STORED summary costs nothing and needs no model — so it is gated
   * on queue access rather than on the generation permission.
   */
  @Get('summary')
  @RequirePermission('ticket.read.all')
  getSummary(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSummaryResponseDto> {
    return this.aiGrpcClient.getSummary(ticketId, context);
  }

  /**
   * 200, not 201.
   *
   * The summary is a 1:1 upsert — re-generating REPLACES the row rather than
   * creating a second one — so "created" would be a lie on every call after the
   * first, and a client keying off 201 would treat a replacement as a new
   * resource.
   */
  @Post('summary')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Summary generated')
  generateSummary(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSummaryResponseDto> {
    return this.aiGrpcClient.generateSummary(ticketId, context);
  }

  /**
   * Returns a draft; persists NOTHING.
   *
   * The agent reads it, edits it and decides. `POST /tickets/:id/messages` with
   * `invokeAi` is the path that does persist, and keeping the two separate is
   * what stops an unreviewed generated reply reaching a customer.
   */
  @Post('draft')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  generateDraft(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: GenerateDraftDto,
  ): Promise<AiDraftResponseDto> {
    return this.aiGrpcClient.generateDraft(ticketId, dto, context);
  }

  @Post('suggestions')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  getSuggestions(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiSuggestionDto[]> {
    return this.aiGrpcClient.getSuggestions(ticketId, context);
  }

  @Post('classify')
  @RequirePermission('ticket.ai.use')
  @HttpCode(HttpStatus.OK)
  classify(
    @CurrentUser() context: RequestContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<AiClassificationDto> {
    return this.aiGrpcClient.classifyTicket(ticketId, context);
  }
}
