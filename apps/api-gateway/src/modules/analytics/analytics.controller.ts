import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  AnalyticsRangeQueryDto,
  AnalyticsTopNQueryDto,
  CreateExportDto,
  DocumentAnalyticsQueryDto,
} from './dto/rest/analytics.dto';
import {
  AgentAnalyticsDto,
  AiUsageDto,
  AnalyticsExportDto,
  DeflectionDto,
  DocumentAnalyticsDto,
  KnowledgeGapsDto,
  OverviewDto,
  ResponseTimesDto,
  SatisfactionDto,
  VolumeDto,
} from './dto/rest/analytics-response.dto';

/**
 * The executive dashboard — api-endpoints-plan §4, implemented per 19-doc.
 *
 * **`analytics.read` throughout, and every route is a GET.** Analytics is a
 * read projection: there is nothing here to create, and the one write-shaped
 * operation — the rollup — is platform-operated and deliberately not routed
 * for a tenant, because a backfill recomputes numbers a customer may already
 * have exported.
 *
 * Tenant scoping happens in the owning services, from the caller context in
 * gRPC metadata. No route here accepts an organization id, so reading another
 * tenant's dashboard is unexpressible rather than merely refused.
 */
@ApiTags('Analytics')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('analytics.read')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiOperation({ summary: 'Overview' })
  @ApiWrappedResponse(OverviewDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Overview' })
  @ApiWrappedResponse(OverviewDto)
  @ApiFilterErrors(['401', '403'])
  @Get('overview')
  overview(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<OverviewDto> {
    return this.analytics.overview(query, context);
  }

  /** The product's headline claim (product-overview §7), defined once in §3.1. */
  @ApiOperation({ summary: 'Deflection' })
  @ApiWrappedResponse(DeflectionDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Deflection' })
  @ApiWrappedResponse(DeflectionDto)
  @ApiFilterErrors(['401', '403'])
  @Get('deflection')
  deflection(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<DeflectionDto> {
    return this.analytics.deflection(query, context);
  }

  /** Human and AI first-response reported SEPARATELY, never blended. */
  @ApiOperation({ summary: 'Response times' })
  @ApiWrappedResponse(ResponseTimesDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Response times' })
  @ApiWrappedResponse(ResponseTimesDto)
  @ApiFilterErrors(['401', '403'])
  @Get('response-times')
  responseTimes(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<ResponseTimesDto> {
    return this.analytics.responseTimes(query, context);
  }

  @ApiOperation({ summary: 'Volume' })
  @ApiWrappedResponse(VolumeDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Volume' })
  @ApiWrappedResponse(VolumeDto)
  @ApiFilterErrors(['401', '403'])
  @Get('volume')
  volume(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<VolumeDto> {
    return this.analytics.volume(query, context);
  }

  @ApiOperation({ summary: 'Satisfaction' })
  @ApiWrappedResponse(SatisfactionDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Satisfaction' })
  @ApiWrappedResponse(SatisfactionDto)
  @ApiFilterErrors(['401', '403'])
  @Get('satisfaction')
  satisfaction(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<SatisfactionDto> {
    return this.analytics.satisfaction(query, context);
  }

  @ApiOperation({ summary: 'Ai usage' })
  @ApiWrappedResponse(AiUsageDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Ai usage' })
  @ApiWrappedResponse(AiUsageDto)
  @ApiFilterErrors(['401', '403'])
  @Get('ai-usage')
  aiUsage(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<AiUsageDto> {
    return this.analytics.aiUsage(query, context);
  }

  /** Cross-service: ticket stats ∪ ledger acceptance ∪ name hydration. */
  @ApiOperation({ summary: 'Agents' })
  @ApiWrappedResponse(AgentAnalyticsDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Agents' })
  @ApiWrappedResponse(AgentAnalyticsDto)
  @ApiFilterErrors(['401', '403'])
  @Get('agents')
  agents(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<AgentAnalyticsDto> {
    return this.analytics.agents(query, context);
  }

  @ApiOperation({ summary: 'Knowledge gaps' })
  @ApiWrappedResponse(KnowledgeGapsDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Knowledge gaps' })
  @ApiWrappedResponse(KnowledgeGapsDto)
  @ApiFilterErrors(['401', '403'])
  @Get('knowledge-gaps')
  knowledgeGaps(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsTopNQueryDto,
  ): Promise<KnowledgeGapsDto> {
    return this.analytics.knowledgeGaps(query, context);
  }

  @ApiOperation({ summary: 'Documents' })
  @ApiWrappedResponse(DocumentAnalyticsDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Documents' })
  @ApiWrappedResponse(DocumentAnalyticsDto)
  @ApiFilterErrors(['401', '403'])
  @Get('documents')
  documents(
    @CurrentUser() context: RequestContext,
    @Query() query: DocumentAnalyticsQueryDto,
  ): Promise<DocumentAnalyticsDto> {
    return this.analytics.documents(query, context);
  }

  /**
   * Queues an export — 19-doc §5.
   *
   * **POST, not the GET the endpoint plan names.** It creates a job and
   * produces a file: a GET that writes is one a browser prefetch, a link
   * preview or an automatic retry can trigger, and each of those would produce
   * another file against a tenant's storage. The plan's own description — "an
   * async report export → returns a job id, then a download URL" — is a
   * creation whatever the verb says.
   *
   * 202, because the work has been accepted and has not happened.
   */
  @ApiOperation({ summary: 'Create export' })
  @ApiWrappedResponse(AnalyticsExportDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401', '403'])
  @ApiOperation({ summary: 'Create export' })
  @ApiWrappedResponse(AnalyticsExportDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401', '403'])
  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  createExport(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateExportDto,
  ): Promise<AnalyticsExportDto> {
    return this.analytics.createExport(dto, context);
  }

  /** Poll for the file. Another tenant's id answers 404, never 403. */
  @ApiOperation({ summary: 'Get export' })
  @ApiWrappedResponse(AnalyticsExportDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @ApiOperation({ summary: 'Get export' })
  @ApiWrappedResponse(AnalyticsExportDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get('export/:id')
  getExport(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsExportDto> {
    return this.analytics.getExport(id, context);
  }
}
