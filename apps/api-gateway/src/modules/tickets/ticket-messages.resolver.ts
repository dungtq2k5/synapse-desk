import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TicketMessageResponseGqlDto } from './dto/graphql/message-response.gql-dto';
import { UserSummaryGqlDto } from '../users/dto/graphql/user-summary.gql-dto';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { toUserSummaryGqlDto } from '../users/user.mapper';

/**
 * `TicketMessage.sender`
 *
 * Its own resolver class because `@ResolveField` attaches to the type named by
 * `@Resolver()`, and this field belongs to `TicketMessage` rather than to
 * `Ticket`. Putting it on `TicketsResolver` would silently attach it to the
 * wrong type — one of the few GraphQL mistakes that fails loudly, at schema
 * build, which is the good kind.
 */
@Resolver(() => TicketMessageResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TicketMessagesResolver {
  @ResolveField(() => UserSummaryGqlDto, {
    nullable: true,
    description:
      'Who wrote the message. Null for an AI-generated one — no user did, ' +
      'and naming one would put words in their mouth in a permanent record.',
  })
  async sender(
    @Parent() message: TicketMessageResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryGqlDto | null> {
    if (!message.senderId) return null;

    // The SAME loader the ticket's `assignee` and `author` use, so a thread
    // where one agent wrote twelve messages fetches them once.
    return toUserSummaryGqlDto(await loaders.users.load(message.senderId));
  }
}
