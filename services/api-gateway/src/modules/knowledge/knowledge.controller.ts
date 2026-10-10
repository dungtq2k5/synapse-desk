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
import { KnowledgeArticlesService } from './knowledge-articles.service';
import {
  KnowledgeArticleBlocksQueryDto,
  KnowledgeAskDto,
  KnowledgeSearchDto,
  ListKnowledgeArticlesQueryDto,
} from './dto/rest/knowledge.dto';
import {
  KnowledgeArticleDetailResponseDto,
  KnowledgeArticleResponseDto,
} from './dto/rest/knowledge-article-response.dto';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import {
  KnowledgeAskResponseDto,
  KnowledgeSearchResponseDto,
} from './dto/rest/knowledge-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
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
// `PermissionGuard` with no `@RequirePermission` anywhere is DELIBERATE, and it
// is not a no-op twice over. It throws `UnauthorizedException` before it
// reflects, so it asserts a caller exists independently of `JwtAuthGuard`; and
// it is what makes a `@RequirePermission` added to this file later actually
// enforce. Without it the decorator would compile, Swagger would document the
// permission, and the route would stay open — a failure mode nothing in this
// repo sweeps for, unlike the client and resolver rules.
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly articles: KnowledgeArticlesService,
  ) {}

  /**
   * The help centre: every article this caller may read.
   *
   * **An article is a document that is visible to the caller, `INDEXED`, and
   * not soft-deleted** — not a separate entity, and not a curated subset.
   * There is no publication flag in the schema and inventing one now would
   * default either to a no-op or to a permanently empty help centre.
   *
   * **No permission guard, like every route in this file.** `END_USER` holds no
   * permissions at all, and this surface exists for them: it is what someone
   * reads before opening a ticket. Listing titles discloses strictly less than
   * `search` and Tier 1 chat already do — they retrieve from this same corpus,
   * through the same predicate, and quote its contents back.
   */
  // No `@Throttle`, unlike both AI routes below. `AI_THROTTLER_TIER` prices
  // MODEL spend; these two read Postgres and generate nothing, so they carry
  // the app-wide default like every other list route.
  @ApiOperation({ summary: 'List the knowledge articles this caller may read' })
  @ApiWrappedResponse(Paginated(KnowledgeArticleResponseDto))
  @ApiFilterErrors(['400', '401'])
  @Get('articles')
  listArticles(
    @CurrentUser() context: RequestContext,
    @Query() query: ListKnowledgeArticlesQueryDto,
  ): Promise<PaginationResponseDto<KnowledgeArticleResponseDto>> {
    return this.articles.list(query, context);
  }

  /**
   * One article, with a page of its text.
   *
   * The text is the extracted chunks in reading order, not a download URL: a
   * help centre renders in a browser, and `INDEXED` is exactly the status that
   * guarantees the chunks exist — a document that parsed to nothing never
   * became an article. The original file is still available through
   * `GET /documents/:id/download` for anyone entitled to it.
   *
   * `meta` on the response describes the BLOCK range, since a 200-page handbook
   * is hundreds of blocks and returning it whole is not an option.
   */
  @ApiOperation({ summary: 'Get one article and a page of its text' })
  @ApiWrappedResponse(KnowledgeArticleDetailResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get('articles/:id')
  getArticle(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: KnowledgeArticleBlocksQueryDto,
  ): Promise<KnowledgeArticleDetailResponseDto> {
    return this.articles.get(id, query, context);
  }

  /**
   * One-shot Q&A over the same corpus `search` retrieves from.
   *
   * **Refuses at the cap where `search` degrades, and that asymmetry is the
   * design.** At the AI cap `POST /knowledge/search` returns 200 with
   * `degraded: "LEXICAL_ONLY"` — it drops the embedding call and answers from
   * its lexical arm. This route returns **402**, because a generated answer has
   * no degraded form: there is no cheaper version of writing prose. A reader
   * who has just read `search` will otherwise take the 402 for an
   * inconsistency.
   *
   * `DOC_MISSING` comes back as a status with an explicit "nothing covers this"
   * rather than an invented answer, and — unlike the ticket path — with no
   * handoff offered, because a one-shot question has no conversation to
   * escalate into.
   */
  // A tighter limit than `search`: this GENERATES as well as retrieves, so it
  // costs an order of magnitude more per call. Pricing it like a retrieval
  // would let one user spend the month's generation budget in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.knowledgeAsk })
  @ApiOperation({
    summary:
      'One-shot Q&A over the knowledge base — retrieval plus generation, with citations',
  })
  @ApiWrappedResponse(KnowledgeAskResponseDto)
  // 402 is the AI cap. It reaches here as `PERMISSION_DENIED` carrying an
  // `[http:402]` marker precisely so it does NOT surface as 403, which would
  // send an admin hunting role grants for a billing problem.
  @ApiFilterErrors(['400', '401', '402'])
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Answer generated')
  ask(
    @CurrentUser() context: RequestContext,
    @Body() dto: KnowledgeAskDto,
  ): Promise<KnowledgeAskResponseDto> {
    return this.knowledge.ask(dto, context);
  }

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
