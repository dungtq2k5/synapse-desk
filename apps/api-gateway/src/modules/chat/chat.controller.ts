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
import {
  AI_THROTTLER_TIER,
  ROUTE_THROTTLE,
} from '../../common/config/throttler.config';
import { RequestContext, TicketSource } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { TicketsGrpcClient } from '../tickets/tickets-grpc.client';
import { MessagesGrpcClient } from '../tickets/messages-grpc.client';
import { TicketResponseDto } from '../tickets/dto/rest/ticket-response.dto';
import {
  CreateMessageResponseDto,
  MessageResponseDto,
} from '../tickets/dto/rest/message-response.dto';
import {
  CreateMessageDto,
  ListMessagesQueryDto,
} from '../tickets/dto/rest/message.dto';
import { ListTicketsQueryDto } from '../tickets/dto/rest/ticket.dto';
import { StartConversationDto } from './dto/rest/chat.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';

/**
 * Self-service chat — a THIN WRAPPER, and nothing else.
 *
 * Every route here forwards to the same gRPC client `/tickets/*` uses. There is
 * no chat table, no chat service and no chat business logic, because a
 * "conversation" IS a ticket with `source = CHAT`. What this controller
 * provides is a URL shape an end user's client can be written against without
 * knowing the word "ticket" — and that is the entire feature.
 *
 * The temptation this file exists to resist is re-implementing the rules under
 * a friendlier path. A second `createTicket` that forgot to force
 * `status = NEW`, or a second message endpoint that forgot the internal-note
 * filter, would be a security hole reachable only through the chat URL — and
 * nobody would think to look for it there.
 */
@ApiTags('Chat')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('chat')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ChatController {
  constructor(
    private readonly ticketsGrpcClient: TicketsGrpcClient,
    private readonly messagesGrpcClient: MessagesGrpcClient,
  ) {}

  /**
   * No `ticket.create` permission, unlike `POST /tickets`.
   *
   * Starting a conversation IS the product's entry point for an end user, and
   * requiring a grant to use it would mean a customer needed an administrator
   * before they could ask a question. The direct `/tickets` route keeps its
   * permission because it can raise a ticket ON BEHALF of somebody else —
   * which this one cannot: the author is always the caller.
   */
  @ApiOperation({
    summary: 'Start a Tier 1 conversation → creates a NEW ticket',
  })
  @ApiWrappedResponse(TicketResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401'])
  @Post('conversations')
  @ResponseMessage('Conversation started')
  start(
    @CurrentUser() context: RequestContext,
    @Body() dto: StartConversationDto,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.create(
      {
        title: dto.title,
        description: dto.message,
        priority: dto.priority,
        // The ONLY thing that distinguishes a conversation from a ticket. Set
        // here rather than accepted from the body, so a client cannot open a
        // chat that reports itself as having arrived by email.
        source: TicketSource.CHAT,
        authorId: undefined,
      },
      context,
    );
  }

  /**
   * The caller's own conversations.
   *
   * `source=CHAT` is forced, and `authorId` is pinned to the caller rather than
   * left to ticket-service's visibility filter. The filter alone would also
   * show an agent every chat in the tenant once they hold `ticket.read.all` —
   * correct for the queue view at `/tickets`, wrong for "my conversations",
   * which is what this path means.
   */
  @ApiOperation({ summary: 'List own conversations' })
  @ApiWrappedResponse(Paginated(TicketResponseDto))
  @ApiFilterErrors(['401'])
  @Get('conversations')
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListTicketsQueryDto,
  ): Promise<PaginationResponseDto<TicketResponseDto>> {
    return this.ticketsGrpcClient.list(
      {
        ...query,
        source: TicketSource.CHAT,
        authorId: context.sub,
        includeDeleted: false,
      },
      context,
    );
  }

  @ApiOperation({ summary: 'Thread + citations per AI message' })
  @ApiWrappedResponse(TicketResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get('conversations/:id')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.get(id, context);
  }

  @ApiOperation({ summary: 'List messages' })
  @ApiWrappedResponse(Paginated(MessageResponseDto))
  @ApiFilterErrors(['400', '401', '404'])
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<PaginationResponseDto<MessageResponseDto>> {
    return this.messagesGrpcClient.list(id, query, context);
  }

  /**
   * Asking a question — the same write as `POST /tickets/:id/messages`.
   *
   * `isInternalNote` is forced false rather than passed through: an end-user
   * surface has no notion of an agent-only note, and forwarding the flag would
   * mean the only thing stopping a chat client from writing one is a permission
   * check it could not see. It is refused here, at the shape.
   */
  // A per-USER minute limit, on top of the monthly quota — 16-doc §2. The
  // quota is a month budget checked per request and does nothing to stop one
  // user spending the whole month in ten minutes.
  @Throttle({ [AI_THROTTLER_TIER]: ROUTE_THROTTLE.chatMessage })
  @ApiOperation({ summary: 'Ask a question' })
  @ApiWrappedResponse(CreateMessageResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '404'])
  @Post('conversations/:id/messages')
  @ResponseMessage('Message sent')
  sendMessage(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
  ): Promise<CreateMessageResponseDto> {
    return this.messagesGrpcClient.create(
      id,
      {
        content: dto.content,
        isInternalNote: false,
        invokeAi: dto.invokeAi,
        // Forwarded rather than dropped — 36-doc §1.3. This is the surface a
        // customer asks a question from, so it is the surface where the
        // screenshot and the question arrive together.
        attachments: dto.attachments,
      },
      context,
    );
  }

  /**
   * A literal alias. One line, on purpose.
   *
   * `POST /tickets/:id/escalate` runs the transition table, the side effects
   * and the fire-and-forget summary. Re-deriving any of that here would give
   * chat its own escalation semantics, and the first divergence would be a
   * ticket that escalated without an `escalated_at`.
   */
  @ApiOperation({
    summary:
      'One-click hand-off to a human — alias of POST /tickets/:id/escalate',
  })
  @ApiWrappedResponse(TicketResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Post('conversations/:id/escalate')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Handed off to an agent')
  escalate(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TicketResponseDto> {
    return this.ticketsGrpcClient.escalate(id, context);
  }
}
