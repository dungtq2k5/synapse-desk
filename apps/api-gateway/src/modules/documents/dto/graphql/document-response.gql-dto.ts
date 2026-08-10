import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { DocumentStatus } from '@synapsedesk/common';
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
   * The uploader's id, flat beside the `createdBy` edge — 26-doc §3.
   *
   * Same rule as `Ticket.currentAssigneeId`: a client that wants the id must
   * not pay a network call for it.
   */
  @Field(() => ID)
  createdById!: string;

  @Field(() => String)
  title!: string;

  @Field(() => String)
  fileType!: string;

  @Field(() => Int)
  fileSizeBytes!: number;

  @Field(() => Boolean)
  isOrganizationWide!: boolean;

  @Field(() => DocumentStatus, { nullable: true })
  status!: DocumentStatus | null;

  /** The ids, flat. The resolved departments are the `departments` edge. */
  @Field(() => [ID])
  departmentIds!: string[];

  /**
   * **A field, not a connection** — 26-doc §3. The service already has this
   * number; `chunks { totalCount }` would fetch chunks in order to count them.
   */
  @Field(() => Int)
  chunkCount!: number;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;
}
