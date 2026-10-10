import { ArgsType, Field } from '@nestjs/graphql';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { IngestionJobStatus } from '@synapsedesk/common';
import { PageArgsGqlDto } from '../../../../common/dto/graphql/page-args.gql-dto';
import '../../../../common/graphql/enums';

/**
 * Arguments for `Query.ingestionJobs`
 *
 * A separate `@ArgsType` rather than the REST query DTO, for the reason
 * `tickets-args.gql-dto.ts` gives at length: the REST shape is built with
 * `@nestjs/swagger` helpers and carries no GraphQL metadata, so a class that
 * looks identical would publish no arguments at all.
 *
 * The two filters match the REST route exactly. Nothing is added here — a
 * filter the REST list cannot express would be a second query surface with
 * different capabilities, which is what the read-side rule — a subset, not a
 * mirror — forbids in the direction people actually drift.
 *
 * **`PageArgsGqlDto` and not `SearchPageArgsGqlDto`, deliberately.** This class
 * used to inherit `searchTerm`, so the schema published
 * `ingestionJobs(searchTerm:)`, validated it, forwarded it through
 * `toPageQuery` — and ingestion-service ignored it (known-gaps #6). There is no
 * column on an ingestion job a person searches, so the REST route now refuses
 * the parameter; inheriting it here would leave GraphQL advertising exactly
 * what REST answers with a 400, which is the drift the paragraph above names.
 */
@ArgsType()
export class IngestionJobsArgsGqlDto extends PageArgsGqlDto {
  @Field(() => IngestionJobStatus, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(IngestionJobStatus))
  status?: IngestionJobStatus;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  documentId?: string;
}
