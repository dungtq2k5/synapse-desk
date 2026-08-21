import {
  Body,
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
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { FeedbackService } from './feedback.service';
import { FeedbackResponseDto } from './dto/rest/feedback-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
} from './dto/rest/feedback.dto';

/**
 * Rating an AI answer — `/messages/:messageId/feedback`.
 *
 * Ungated: anyone who can READ a message can say whether it helped, and gating
 * that would collect the opinions only of people senior enough to be granted an
 * opinion — which is precisely the wrong sample for judging whether the model
 * serves ordinary users. ticket-service scopes each write through the message's
 * ticket, so "can read" is enforced there rather than by a route permission.
 */
@ApiTags('Feedback')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('messages/:messageId/feedback')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MessageFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // 200, not 201: this is an UPSERT. Changing a thumb up to a thumb down is the
  // normal case, and "created" would be a lie every time after the first.
  @ApiOperation({
    summary:
      'Thumbs up/down on an AI answer → ai_response_feedbacks (rating ∈ {1,-1}, feedback_text?, citation_accurate?)',
  })
  @ApiWrappedResponse(FeedbackResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Feedback recorded')
  submit(
    @CurrentUser() context: RequestContext,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: SubmitFeedbackDto,
  ): Promise<FeedbackResponseDto> {
    return this.feedback.submit(messageId, dto, context);
  }

  /**
   * The caller's own rating on this message, or `null`.
   *
   * **The one case a subset route is not redundant.** `GET /feedback` returns a
   * superset in principle, but it filters only on `rating`, `citationAccurate`
   * and a date range — no message, no user — and it is gated on
   * `analytics.read`. So the caller who wants this cannot reach it there, which
   * is the difference between this route and the ones doc 43 §1 struck.
   *
   * `null` and 200, never 404: a client asks this for every AI message it
   * renders, and "not rated" is the ordinary answer rather than an error.
   */
  @ApiOperation({ summary: 'Own feedback on that message' })
  @ApiWrappedResponse(FeedbackResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get()
  own(
    @CurrentUser() context: RequestContext,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<FeedbackResponseDto | null> {
    return this.feedback.get(messageId, context);
  }

  // SELF only, and structurally so: the service keys the delete on
  // `(messageId, callerId)`, so there is no parameter through which one user
  // could withdraw another's opinion.
  @ApiOperation({ summary: 'Withdraw feedback' })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400', '401', '404'])
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(
    @CurrentUser() context: RequestContext,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.feedback.withdraw(messageId, context);
  }
}

/**
 * The tenant's feedback stream — `analytics.read`, not `ticket.read.all`.
 *
 * This is a quality-review surface: it aggregates what users thought of the
 * model, across every conversation in the tenant. That is an analytics
 * question, and an agent who can work a queue has not thereby been granted the
 * right to read everyone's opinions of it.
 */
@Controller('feedback')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // NOT "own feedback on that message" — that is
  // `GET /messages/:messageId/feedback`, and this summary was a copy of its
  // plan row sitting on the tenant-wide stream.
  @ApiOperation({
    summary:
      'Tenant feedback stream for quality review; filters ?rating=&citationAccurate=&from=&to=',
  })
  @ApiWrappedResponse(Paginated(FeedbackResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get()
  @RequirePermission('analytics.read')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListFeedbackQueryDto,
  ): Promise<PaginationResponseDto<FeedbackResponseDto>> {
    return this.feedback.list(query, context);
  }
}
