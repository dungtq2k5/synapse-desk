import { Field, ObjectType } from '@nestjs/graphql';
import { PageMetaGqlDto } from '../../../../common/dto/graphql/page-meta.gql-dto';
import { TicketResponseGqlDto } from './ticket-response.gql-dto';

/**
 * A page of tickets.
 *
 * GraphQL-only: REST returns its own envelope, so there is nothing for the base
 * class to share here. Lives beside the ticket it pages rather than in a file
 * that also held `UserPage`, `DocumentPage`, `NotificationFeed` and
 * `DepartmentPage` — which is what `ticket-page.type.ts` had become, a name that
 * had stopped describing four of the five types in it.
 */
@ObjectType('TicketPage')
export class TicketPageGqlDto {
  @Field(() => [TicketResponseGqlDto])
  items!: TicketResponseGqlDto[];

  @Field(() => PageMetaGqlDto)
  meta!: PageMetaGqlDto;
}
