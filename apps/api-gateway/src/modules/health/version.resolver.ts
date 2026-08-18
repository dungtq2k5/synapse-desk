import { Query, Resolver } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';
import { readBuildInfo } from '@synapsedesk/common';
import { VersionResponseGqlDto } from './dto/graphql/version-response.gql-dto';

/**
 * `Query.version` — the GraphQL twin of `GET /version`.
 *
 * **It exists to make the surface valid.** GraphQL requires a non-empty `Query`
 * root type, so a schema with no queries fails to generate at boot with an error
 * about a missing root rather than anything about resolvers. Something has to be
 * first, and this is the smallest thing that is genuinely useful rather than a
 * placeholder someone has to remember to delete.
 *
 * Deliberately NOT a domain type: domain resolvers build those, and starting the schema
 * with a ticket would mean designing the entity graph inside a module-setup
 * change.
 */
@Resolver(() => VersionResponseGqlDto)
export class VersionResolver {
  private readonly info: VersionResponseGqlDto;

  constructor(configService: ConfigService) {
    this.info = readBuildInfo(configService);
  }

  /**
   * PUBLIC, like `GET /version` — no guard.
   */
  @Query(() => VersionResponseGqlDto, {
    description:
      'Which build is answering this request. The GraphQL twin of GET /version.',
  })
  version(): VersionResponseGqlDto {
    return this.info;
  }
}
