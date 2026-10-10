import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '@synapsedesk/common';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import { IngestionJobsService } from './ingestion-jobs.service';
import { ListIngestionJobsQueryDto } from './dto/rest/ingestion-job.dto';
import { IngestionJobResponseDto } from './dto/rest/ingestion-job-response.dto';

/** The ingestion pipeline worklist. */
@ApiTags('Ingestion Jobs')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('ingestion-jobs')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class IngestionJobsController {
  constructor(private readonly jobs: IngestionJobsService) {}

  @ApiOperation({ summary: 'List ingestion jobs' })
  @ApiWrappedResponse(Paginated(IngestionJobResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @RequirePermission('document.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListIngestionJobsQueryDto,
  ): Promise<PaginationResponseDto<IngestionJobResponseDto>> {
    return this.jobs.list(query, context);
  }

  @ApiOperation({ summary: 'Get one ingestion job' })
  @ApiWrappedResponse(IngestionJobResponseDto)
  @ApiFilterErrors(['401', '403', '404'])
  @Get(':id')
  @RequirePermission('document.read')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IngestionJobResponseDto> {
    return this.jobs.get(id, context);
  }

  @ApiOperation({ summary: 'Retry an ingestion job' })
  @ApiWrappedResponse(IngestionJobResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/retry')
  @RequirePermission('document.reindex')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Ingestion retry queued')
  retry(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IngestionJobResponseDto> {
    return this.jobs.retry(id, context);
  }

  @ApiOperation({ summary: 'Cancel an ingestion job' })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Delete(':id')
  @RequirePermission('document.reindex')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.jobs.cancel(id, context);
  }
}
