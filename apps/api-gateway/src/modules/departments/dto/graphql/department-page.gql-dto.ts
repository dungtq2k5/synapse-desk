import { Field, ObjectType } from '@nestjs/graphql';
import { PageMetaGqlDto } from '../../../../common/dto/graphql/page-meta.gql-dto';
import { DepartmentResponseGqlDto } from './department-response.gql-dto';

/** A page of departments. */
@ObjectType('DepartmentPage')
export class DepartmentPageGqlDto {
  @Field(() => [DepartmentResponseGqlDto])
  items!: DepartmentResponseGqlDto[];

  @Field(() => PageMetaGqlDto)
  meta!: PageMetaGqlDto;
}
