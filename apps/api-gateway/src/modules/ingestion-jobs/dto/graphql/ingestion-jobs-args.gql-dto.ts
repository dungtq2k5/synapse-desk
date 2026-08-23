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
 * different capabilities, which is what doc 42 §3's "subset, not a mirror"
 * rules out in the direction people actually drift.
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
