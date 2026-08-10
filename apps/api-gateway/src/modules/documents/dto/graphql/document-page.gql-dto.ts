import { Field, ObjectType } from '@nestjs/graphql';
import { PageMetaGqlDto } from '../../../../common/dto/graphql/page-meta.gql-dto';
import { DocumentResponseGqlDto } from './document-response.gql-dto';

/** A page of knowledge-base documents. */
@ObjectType('DocumentPage')
export class DocumentPageGqlDto {
  @Field(() => [DocumentResponseGqlDto])
  items!: DocumentResponseGqlDto[];

  @Field(() => PageMetaGqlDto)
  meta!: PageMetaGqlDto;
}
