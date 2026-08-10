import { Field, ObjectType } from '@nestjs/graphql';
import { PageMetaGqlDto } from '../../../../common/dto/graphql/page-meta.gql-dto';
import { UserResponseGqlDto } from './user-response.gql-dto';

/** A page of users, from `Query.users` — behind `user.read`, like the REST list. */
@ObjectType('UserPage')
export class UserPageGqlDto {
  @Field(() => [UserResponseGqlDto])
  items!: UserResponseGqlDto[];

  @Field(() => PageMetaGqlDto)
  meta!: PageMetaGqlDto;
}
