import {
  Args,
  Context,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import type { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import {
  AgentAnalyticsResponseGqlDto,
  AgentStatResponseGqlDto,
  AnalyticsOverviewResponseGqlDto,
  DocumentAnalyticsResponseGqlDto,
  DocumentUsageResponseGqlDto,
  KnowledgeGapFlagResponseGqlDto,
  KnowledgeGapsResponseGqlDto,
} from './dto/graphql/analytics-response.gql-dto';
import { UserSummaryResponseGqlDto } from '../users/dto/graphql/user-response.gql-dto';
import { DocumentResponseGqlDto } from '../documents/dto/graphql/document-response.gql-dto';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { ANALYTICS_TOP_N } from '@synapsedesk/common';

/**
 * The analytics queries
 *
 * **Four of the ten REST reads, chosen by composition rather than parity.** A
 * read earns a query here when its rows carry entity ids a loader can resolve
 * — `agents`, `documents`, `knowledge-gaps` — or when it is the headline figure
 * a screen opens with, which is `overview`. The chart series have no entity id
 * in any row, so a GraphQL query for one would be a REST call with more syntax
 * and a second cache path.
 *
 * `overview` is the one WITHOUT edges. See {@link AnalyticsOverviewResponseGqlDto} for
 * why decomposing it would be a mistake rather than an improvement.
 *
 * It calls `AnalyticsService` rather than a gRPC client, and that is not an
 * exception to "a resolver is a transport": the overview is composed from THREE
 * services with its own caching and staleness reporting, and that composition
 * is the service's job on both transports.
 */
@Resolver()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AnalyticsResolver {
  constructor(private readonly analytics: AnalyticsService) {}

  @Query(() => AnalyticsOverviewResponseGqlDto, {
    description:
      'Headline figures for a date range. `computedAt` says when the rollups ' +
      'ran and `dataThrough` says what they cover — the gap between them is ' +
      'how a stale scheduler is diagnosed.',
  })
  @RequirePermission('analytics.read')
  async analyticsOverview(
    @Args('from', { type: () => String }) from: string,
    @Args('to', { type: () => String }) to: string,
    @CurrentUser() context: RequestContext,
  ): Promise<AnalyticsOverviewResponseGqlDto> {
    return await this.analytics.overview({ from, to }, context);
  }

  @Query(() => AgentAnalyticsResponseGqlDto, {
    description:
      'Per-agent throughput. Ask for `agent { … }` to resolve names through ' +
      'the users loader; a query that only wants the numbers costs no call ' +
      'to auth-service at all.',
  })
  @RequirePermission('analytics.read')
  async analyticsAgents(
    @Args('from', { type: () => String }) from: string,
    @Args('to', { type: () => String }) to: string,
    @CurrentUser() context: RequestContext,
  ): Promise<AgentAnalyticsResponseGqlDto> {
    // **`hydrateNames: false` is the whole point of the edge**.
    // The service's third leg calls the same `ListUsersByIds` the users loader
    // does; running it here as well would make every numbers-only query pay
    // for a round trip whose result no field reads.
    return await this.analytics.agents({ from, to }, context, {
      hydrateNames: false,
    });
  }

  @Query(() => DocumentAnalyticsResponseGqlDto, {
    description:
      'Which documents the AI retrieves and cites. `mostCited`, ' +
      '`neverRetrieved` and `retrievedNeverCited` are three different ' +
      'findings and are never merged.',
  })
  @RequirePermission('analytics.read')
  async analyticsDocuments(
    @Args('limit', {
      type: () => Int,
      nullable: true,
      defaultValue: ANALYTICS_TOP_N.DEFAULT,
    })
    limit: number,
    @CurrentUser() context: RequestContext,
  ): Promise<DocumentAnalyticsResponseGqlDto> {
    return await this.analytics.documents({ limit }, context);
  }

  @Query(() => KnowledgeGapsResponseGqlDto, {
    description:
      'Where the knowledge base fails to answer — the empty-retrieval rate, ' +
      'and the documents flagged behind it.',
  })
  @RequirePermission('analytics.read')
  async analyticsKnowledgeGaps(
    @Args('from', { type: () => String }) from: string,
    @Args('to', { type: () => String }) to: string,
    @Args('limit', {
      type: () => Int,
      nullable: true,
      defaultValue: ANALYTICS_TOP_N.DEFAULT,
    })
    limit: number,
    @CurrentUser() context: RequestContext,
  ): Promise<KnowledgeGapsResponseGqlDto> {
    return await this.analytics.knowledgeGaps({ from, to, limit }, context);
  }
}

/**
 * `AgentStat.agent` — the edge that justifies putting `agents` in the schema.
 *
 * **A resolver over the loader, not a second hydration path.** It reads the
 * same `ListUsersByIds` the REST composition calls; the only difference is
 * WHEN the join happens — on demand here, unconditionally there. Both read the
 * same rows, so this is not the two-implementations smell: there is no rule
 * being written twice, only an assembly order.
 *
 * Nullable, and it means something: a rollup row outlives the user it counts.
 * An agent who left last month still has last month's numbers, and their id
 * resolves to nothing.
 */
@Resolver(() => AgentStatResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgentStatResolver {
  @ResolveField(() => UserSummaryResponseGqlDto, {
    nullable: true,
    description:
      'The agent behind these numbers. Null when the account no longer ' +
      'exists — a rollup row outlives the user it counts.',
  })
  async agent(
    @Parent() stat: AgentStatResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<UserSummaryResponseGqlDto | null> {
    const user = await loaders.users.load(stat.agentId);

    return user;
  }
}

/**
 * `DocumentUsage.document` — `ListDocumentsByIds`'s first consumer
 *
 * The rollup row carries the title it was written with, so this edge is what a
 * client asks for when it needs the CURRENT document — the title after a
 * rename, the status after a re-ingest. Null when it has since been deleted.
 */
@Resolver(() => DocumentUsageResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DocumentUsageResolver {
  @ResolveField(() => DocumentResponseGqlDto, {
    nullable: true,
    description:
      'The document as it stands now. Null when it has been deleted since ' +
      'the rollup counted it — `title` above is what the rollup recorded.',
  })
  async document(
    @Parent() usage: DocumentUsageResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DocumentResponseGqlDto | null> {
    const document = await loaders.documents.load(usage.documentId);

    return document;
  }
}

/** `KnowledgeGapFlag.document` — the same edge, over the same loader. */
@Resolver(() => KnowledgeGapFlagResponseGqlDto)
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KnowledgeGapFlagResolver {
  @ResolveField(() => DocumentResponseGqlDto, {
    nullable: true,
    description:
      'The flagged document as it stands now. Null when it has been deleted ' +
      'since the flag was raised.',
  })
  async document(
    @Parent() flag: KnowledgeGapFlagResponseGqlDto,
    @Context() { loaders }: GqlContext,
  ): Promise<DocumentResponseGqlDto | null> {
    const document = await loaders.documents.load(flag.documentId);

    return document;
  }
}
