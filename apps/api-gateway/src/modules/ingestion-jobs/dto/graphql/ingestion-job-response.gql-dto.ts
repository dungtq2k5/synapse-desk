import { Field, ID, ObjectType } from '@nestjs/graphql';
import { IngestionJobStatus } from '@synapsedesk/common';
import { PageMetaResponseGqlDto } from '../../../../common/dto/graphql/page-meta-response.gql-dto';
import '../../../../common/graphql/enums';

/**
 * One ingestion attempt, as the GraphQL schema serves it.
 *
 * The reason this type is on the schema at all is the `document` edge: the REST
 * shape carries `documentId` and nothing else about what is being ingested, so
 * a pipeline dashboard is either two round trips or a list of UUIDs.
 */
@ObjectType('IngestionJob')
export class IngestionJobResponseGqlDto {
  @Field(() => ID)
  id!: string;

  /**
   * The document's id, flat beside the `document` edge.
   *
   * Same rule as `Document.createdById`: a client that only needs the id must
   * not pay a network call for it.
   */
  @Field(() => ID)
  documentId!: string;

  /**
   * BullMQ's id for the queued work, empty until the worker has queued it.
   *
   * On the schema rather than REST-only because it is what an operator reading
   * a stuck job types into the queue dashboard — the one field here that exists
   * to be copied out rather than rendered.
   */
  @Field(() => String)
  bullmqJobId!: string;

  /**
   * Null only when the peer sent a member this build does not know.
   *
   * Nullable for a forward-compatibility reason rather than a domain one: a
   * newer ingestion-service can add a status, and a gateway that threw on the
   * unknown member would fail the whole page rather than one field.
   */
  @Field(() => IngestionJobStatus, { nullable: true })
  status!: IngestionJobStatus | null;

  @Field(() => String, { nullable: true })
  errorLog!: string | null;

  /** Null while the attempt is still running. */
  @Field(() => Date, { nullable: true })
  processedAt!: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}

/** A page of ingestion attempts. */
@ObjectType('IngestionJobPage')
export class IngestionJobPageResponseGqlDto {
  @Field(() => [IngestionJobResponseGqlDto])
  items!: IngestionJobResponseGqlDto[];

  @Field(() => PageMetaResponseGqlDto)
  meta!: PageMetaResponseGqlDto;
}
