import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PlatformJobsService } from './platform-jobs.service';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  BackfillJobDto,
  JobHealthResponseDto,
  JobRunResultDto,
} from './dto/platform-jobs.dto';

/**
 * Scheduled-job operations — 20-doc §4.4, §5.
 *
 * `SuperAdminGuard` at CLASS level, as everywhere else under `/platform`: one
 * forgotten decorator here is a way for a tenant admin to trigger a
 * cross-tenant sweep.
 */
@ApiTags('Platform Jobs')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('platform/jobs')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformJobsController {
  constructor(private readonly jobs: PlatformJobsService) {}

  /**
   * **Is anything not running?**
   *
   * The endpoint whose absence cost two domains. Judged against the jobs this
   * build expects rather than the rows that exist, so a scheduler that was
   * never wired reports `never-ran` instead of nothing at all.
   */
  @ApiOperation({ summary: 'Scheduled-job health — 20-doc §4.4' })
  @ApiWrappedResponse(JobHealthResponseDto)
  @ApiFilterErrors(['401'])
  @Get()
  getHealth(
    @CurrentUser() context: RequestContext,
  ): Promise<JobHealthResponseDto> {
    return this.jobs.health(context);
  }

  /**
   * Runs a job now.
   *
   * A POST because it does work — and specifically not a GET, which a browser
   * prefetch or an automatic retry can trigger without anyone asking.
   */
  @ApiOperation({ summary: 'Runs a rollup now — 20-doc §5' })
  @ApiWrappedResponse(JobRunResultDto)
  @ApiFilterErrors(['401', '404'])
  @Post(':name/run')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Job run complete')
  run(
    @Param('name') name: string,
    @CurrentUser() context: RequestContext,
  ): Promise<JobRunResultDto> {
    return this.jobs.run(name, context);
  }

  /**
   * Recomputes an explicit range.
   *
   * Three reasons this small surface is worth having (20-doc §5): fixing a
   * rollup bug requires recomputation or the wrong numbers are permanent; the
   * first run after this ships IS a backfill; and a scheduled job you cannot
   * trigger by hand cannot be debugged in staging without waiting for the
   * clock.
   */
  @ApiOperation({
    summary: 'Recomputes an explicit from..to range, with a mandatory reason',
  })
  @ApiWrappedResponse(JobRunResultDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post(':name/backfill')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Backfill complete')
  backfill(
    @Param('name') name: string,
    @Body() dto: BackfillJobDto,
    @CurrentUser() context: RequestContext,
  ): Promise<JobRunResultDto> {
    return this.jobs.backfill(name, dto, context);
  }
}
