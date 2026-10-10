import {
  Args,
  Context,
  ID,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IngestionJobsService } from './ingestion-jobs.service';
import {
  IngestionJobPageResponseGqlDto,
  IngestionJobResponseGqlDto,
} from './dto/graphql/ingestion-job-response.gql-dto';
import { IngestionJobsArgsGqlDto } from './dto/graphql/ingestion-jobs-args.gql-dto';
import { DocumentResponseGqlDto } from '../documents/dto/graphql/document-response.gql-dto';
import { toPageQuery } from '../../common/graphql/page-query';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';

/**
 * `Query.ingestionJob`, `Query.ingestionJobs`, and the `document` edge.
 *
 * The edge is the reason this resolver exists. `IngestionJobResponseDto` carries
 * `documentId` and nothing else about the document, so the pipeline dashboard —
 * jobs with the titles of what they are ingesting — is two round trips over REST
 * or a screen of UUIDs.
 *
 * Both queries are `document.read`, matching the routes: an ingestion job is
 * metadata about a document, and anyone who can read the document can see how it
 * was ingested. The department boundary is ingestion-service's and is applied
 * inside the same call the REST route makes.
 */
@Resolver(() => IngestionJobResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class IngestionJobsResolver {
  constructor(private readonly jobs: IngestionJobsService) {}

  @Query(() => IngestionJobResponseGqlDto, {
    nullable: true,
    description:
      'One ingestion attempt. Null when it does not exist, or belongs to a ' +
      'document the caller cannot see — deliberately indistinguishable.',
  })
  @RequirePermission('document.read')
  async ingestionJob(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() context: RequestContext,
  ): Promise<IngestionJobResponseGqlDto | null> {
    try {
      return await this.jobs.get(id, context);
    } catch {
      // Swallowed to a null, the same way `Query.document` does it, and for the
      // same reason: distinguishing "no such job" from "a job on a document you
      // cannot see" would answer a question about another department's contents
      // (ADR 0037).
      return null;
    }
  }

  @Query(() => IngestionJobPageResponseGqlDto, {
    // Named explicitly for the reason `documentPage` is: the METHOD cannot be
    // called `ingestionJobs` while the constructor property `jobs` exists
    // alongside a same-named accessor, and the schema must not inherit a
    // collision the class had.
    name: 'ingestionJobs',
    description: 'Ingestion attempts for documents visible to the caller.',
  })
  @RequirePermission('document.read')
  async ingestionJobPage(
    @Args() args: IngestionJobsArgsGqlDto,
    @CurrentUser() context: RequestContext,
  ): Promise<IngestionJobPageResponseGqlDto> {
    return await this.jobs.list(
      {
        ...toPageQuery(args),
        status: args.status,
        documentId: args.documentId,
      },
      context,
    );
  }

  /** `IngestionJob.document` — what this job is ingesting. */
  @ResolveField(() => DocumentResponseGqlDto, {
    nullable: true,
    description:
      'The document being ingested, as it stands now. Null when it has been ' +
      'deleted since the attempt ran — the job row outlives the document.',
  })
  async document(
    @Parent() job: IngestionJobResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DocumentResponseGqlDto | null> {
    return await loaders.documents.load(job.documentId);
  }
}
