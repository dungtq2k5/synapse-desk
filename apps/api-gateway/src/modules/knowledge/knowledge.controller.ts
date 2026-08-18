import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeSearchDto } from './dto/rest/knowledge.dto';
import { KnowledgeSearchResponseDto } from './dto/rest/knowledge-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';

/**
 * `/knowledge` — retrieval, and for now nothing else.
 *
 * **No permission decorator, deliberately.** A knowledge base exists to be read
 * by everyone in the tenant; requiring a grant to look something up would mean
 * an end user needs an admin before they can ask a question. The narrowing that
 * does happen is org-wide ∪ the caller's departments, applied inside
 * `rag-service` from metadata the gateway packed — the SAME predicate
 * `GET /documents` applies, so a document invisible in the list cannot surface
 * here.
 *
 * `POST` rather than `GET` for a read: the query is user text of arbitrary
 * length and it must not land in an access log, a browser history or a
 * referrer header. A support question is frequently the most sensitive thing a
 * user types.
 */
@ApiTags('Knowledge')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('knowledge')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  // A per-USER minute limit, on top of the monthly quota. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.knowledgeSearch })
  @ApiOperation({
    summary:
      "Hybrid semantic + keyword retrieval, filtered by tenant and the caller's departments (RDM §1.2)",
  })
  @ApiWrappedResponse(KnowledgeSearchResponseDto)
  @ApiFilterErrors(['400', '401'])
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Search completed')
  search(
    @CurrentUser() context: RequestContext,
    @Body() dto: KnowledgeSearchDto,
  ): Promise<KnowledgeSearchResponseDto> {
    return this.knowledge.search(dto, context);
  }
}
