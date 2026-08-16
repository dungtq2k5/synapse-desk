import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import { ConfigService } from '@nestjs/config';
import { readBuildInfo } from '@synapsedesk/common';
import { VersionResponseDto } from './dto/health-response.dto';

/**
 * `GET /version`
 *
 * **Which build is this?** During an incident, "did the fix actually roll out?"
 * is the first question anyone asks, and without this every answer is inference
 * from deploy timestamps — which is how twenty minutes get spent debugging a bug
 * that was already fixed in an image that never shipped.
 *
 * PUBLIC, like the probes, and for a related reason: the people who need it
 * during an outage are often the ones whose credentials depend on the service
 * that is down. That is exactly why the payload is three fields and stays three
 * fields — see {@link VersionResponseDto}.
 *
 * Served OUTSIDE the `/api/v1` prefix (see `ops-routes.ts`): this identifies the
 * *process*, not a version of the API, and putting it behind a versioned prefix
 * would mean a future `/api/v2` silently moved the endpoint whose whole job is
 * to be findable.
 *
 * **Read once, at construction.** The values cannot change while the process
 * runs — they were baked into the image — so re-reading them per request would
 * only create the possibility of them differing between two calls.
 */
@ApiTags('Ops')
@Controller('version')
export class VersionController {
  private readonly buildInfo: VersionResponseDto;

  constructor(configService: ConfigService) {
    this.buildInfo = readBuildInfo(configService);
  }

  @ApiOperation({
    summary: 'Which build is this?',
    description:
      'Three fields and no more — version, commit SHA, build time. Node version, ' +
      'dependency lists and environment names are deliberately absent: they turn ' +
      'a support aid into a reconnaissance endpoint on a public route, and none ' +
      'of them answer the question this exists for.',
    security: [],
  })
  @ApiWrappedResponse(VersionResponseDto)
  @ApiFilterErrors()
  @Get()
  version(): VersionResponseDto {
    return this.buildInfo;
  }
}
