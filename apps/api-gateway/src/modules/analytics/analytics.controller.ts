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
@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('analytics.read')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<OverviewDto> {
    return this.analytics.overview(query, context);
  }

  /** The product's headline claim (product-overview §7), defined once in §3.1. */
  @Get('deflection')
  deflection(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<DeflectionDto> {
    return this.analytics.deflection(query, context);
  }

  /** Human and AI first-response reported SEPARATELY, never blended. */
  @Get('response-times')
  responseTimes(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<ResponseTimesDto> {
    return this.analytics.responseTimes(query, context);
  }

  @Get('volume')
  volume(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<VolumeDto> {
    return this.analytics.volume(query, context);
  }

  @Get('satisfaction')
  satisfaction(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<SatisfactionDto> {
    return this.analytics.satisfaction(query, context);
  }

  @Get('ai-usage')
  aiUsage(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<AiUsageDto> {
    return this.analytics.aiUsage(query, context);
  }

  /** Cross-service: ticket stats ∪ ledger acceptance ∪ name hydration. */
  @Get('agents')
  agents(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsRangeQueryDto,
  ): Promise<AgentAnalyticsDto> {
    return this.analytics.agents(query, context);
  }

  @Get('knowledge-gaps')
  knowledgeGaps(
    @CurrentUser() context: RequestContext,
    @Query() query: AnalyticsTopNQueryDto,
  ): Promise<KnowledgeGapsDto> {
    return this.analytics.knowledgeGaps(query, context);
  }

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
  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  createExport(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateExportDto,
  ): Promise<AnalyticsExportDto> {
    return this.analytics.createExport(dto, context);
  }

  /** Poll for the file. Another tenant's id answers 404, never 403. */
  @Get('export/:id')
  getExport(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AnalyticsExportDto> {
    return this.analytics.getExport(id, context);
  }
}
