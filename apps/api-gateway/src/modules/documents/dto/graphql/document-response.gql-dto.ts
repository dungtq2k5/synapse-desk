import { PageMetaResponseGqlDto } from '../../../../common/dto/graphql/page-meta-response.gql-dto';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { DocumentStatus, type DocumentFileType } from '@synapsedesk/common';
import '../../../../common/graphql/enums';

/**
 * A knowledge-base document, as the GraphQL schema serves it.
 *
 * **`fileUrl` and `deletedById` are absent, and the contract spec records why.**
 * `fileUrl` is an internal object path, not a URL, and reads resolve it to a
 * fresh signed URL per request — publishing the raw path would advertise the
 * storage layout and hand clients a value that does not work. Declaring both as
 * REST-only there is what makes the omission a reviewed decision rather than
 * something inferred from which class a field happened to land on.
 */
@ObjectType('Document')
export class DocumentResponseGqlDto {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  organizationId!: string;

  /**
   * The uploader's id, flat beside the `createdBy` edge.
   *
   * Same rule as `Ticket.currentAssigneeId`: a client that wants the id must
   * not pay a network call for it.
   */
  @Field(() => ID)
  createdById!: string;

  @Field(() => String)
  title!: string;

  // `@Field(() => String)` with a narrowed TS type: the decorator decides the
  // SCHEMA, the type decides what the mapper may assign. Promoting it to a
  // GraphQL enum is a breaking schema change, so it needs a versioning call.
  @Field(() => String)
  fileType!: DocumentFileType;

  @Field(() => Int)
  fileSizeBytes!: number;

  @Field(() => Boolean)
  isOrganizationWide!: boolean;

  @Field(() => DocumentStatus, { nullable: true })
  status!: DocumentStatus | null;

  /** The ids, flat. The resolved departments are the `departments` edge. */
  @Field(() => [ID])
  departmentIds!: string[];

  /** How many chunks this document was split into. */
  @Field(() => Int)
  chunkCount!: number;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;
}

/** A page of knowledge-base documents. */
@ObjectType('DocumentPage')
export class DocumentPageResponseGqlDto {
  @Field(() => [DocumentResponseGqlDto])
  items!: DocumentResponseGqlDto[];

  @Field(() => PageMetaResponseGqlDto)
  meta!: PageMetaResponseGqlDto;
}
