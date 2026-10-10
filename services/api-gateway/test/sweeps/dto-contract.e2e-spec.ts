import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { compareContract, type DtoContract } from '../utils/dto-contract';
import {
  PageArgsGqlDto,
  SearchPageArgsGqlDto,
} from '../../src/common/dto/graphql/page-args.gql-dto';
import { ListTicketsQueryDto } from '../../src/modules/tickets/dto/rest/ticket.dto';
import { TicketsArgsGqlDto } from '../../src/modules/tickets/dto/graphql/tickets-args.gql-dto';
import { ListIngestionJobsQueryDto } from '../../src/modules/ingestion-jobs/dto/rest/ingestion-job.dto';
import { IngestionJobsArgsGqlDto } from '../../src/modules/ingestion-jobs/dto/graphql/ingestion-jobs-args.gql-dto';
import { ListDocumentsQueryDto } from '../../src/modules/documents/dto/rest/document.dto';
import { ListUsersQueryDto } from '../../src/modules/users/dto/rest/user-admin.dto';
import { ListRolesQueryDto } from '../../src/modules/roles/dto/rest/role.dto';
import { ListDepartmentsQueryDto } from '../../src/modules/departments/dto/rest/department.dto';

describe('REST and GraphQL DTOs are independent but not divergent', () => {
  const SRC = join(__dirname, '../../src/modules');

  /**
   * REST and GraphQL DTOs agree, without sharing a class, revised.
   *
   * **The guard that replaced inheritance.** Three shapes were tried:
   *
   *   1. `TicketType extends TicketResponseDto`. Justified as making drift a
   *      compile error; it was not. A field added to the parent is inherited and
   *      typed, so it reached REST and was absent from the schema with the
   *      compiler silent and every test green.
   *   2. One collapsed class carrying both decorator sets. That closed the first
   *      direction and opened the worse one — a field added with `@Field()` that
   *      should have been REST-only lands in the PUBLIC schema — while making
   *      every REST DTO import `@nestjs/graphql`.
   *   3. Independent classes, checked here. No coupling, both directions caught,
   *      and every deliberate asymmetry written down rather than inferred from
   *      which class a field happened to sit on.
   *
   * The `restOnly` / `gqlOnly` lists are the real product of this file: under (1)
   * and (2) an omission that was *deliberate* and one that was *forgotten* looked
   * identical. Here they cannot.
   */
  const CONTRACTS: readonly (DtoContract & { name: string })[] = [
    {
      name: 'Ticket',
      restPath: join(SRC, 'tickets/dto/rest/ticket-response.dto.ts'),
      restClass: 'TicketResponseDto',
      gqlPath: join(SRC, 'tickets/dto/graphql/ticket-response.gql-dto.ts'),
      gqlClass: 'TicketResponseGqlDto',
    },
    {
      name: 'TicketMessage',
      restPath: join(SRC, 'tickets/dto/rest/message-response.dto.ts'),
      restClass: 'MessageResponseDto',
      gqlPath: join(SRC, 'tickets/dto/graphql/message-response.gql-dto.ts'),
      gqlClass: 'TicketMessageResponseGqlDto',
      // Internal object paths resolved per request — publishing them would
      // advertise the storage layout and hand clients a value that does not work.
      //
      // `excludedFromAiContext` is REST-only BY DECISION. It is on
      // the REST shape for ONE consumer: `AiStreamService.transcript()`, which
      // filters on it after fetching because the same route serves the UI where
      // the row must stay visible. No client has a use for it, and publishing it
      // would advertise an internal detail of the AI pipeline as product API.
      //
      // `answerStatus` is deliberately NOT here — it reached the schema, because
      // telling a refusal from an answer is something any client reading a
      // thread needs.
      restOnly: ['attachments', 'excludedFromAiContext'],
    },
    {
      name: 'Citation',
      restPath: join(SRC, 'tickets/dto/rest/message-response.dto.ts'),
      restClass: 'CitationResponseDto',
      gqlPath: join(SRC, 'tickets/dto/graphql/message-response.gql-dto.ts'),
      gqlClass: 'CitationResponseGqlDto',
      // `vectorPointId` is REST-only BY DECISION. REST serves it so a client can
      // replace the `ai:stream:done` frame's citations with the persisted ones
      // field for field; the public schema has no frame to reconcile with, and a
      // retrieval key is not product API there.
      restOnly: ['vectorPointId'],
    },
    {
      name: 'IngestionJob',
      restPath: join(
        SRC,
        'ingestion-jobs/dto/rest/ingestion-job-response.dto.ts',
      ),
      restClass: 'IngestionJobResponseDto',
      gqlPath: join(
        SRC,
        'ingestion-jobs/dto/graphql/ingestion-job-response.gql-dto.ts',
      ),
      gqlClass: 'IngestionJobResponseGqlDto',
    },
    {
      name: 'Role',
      restPath: join(SRC, 'roles/dto/rest/role-response.dto.ts'),
      restClass: 'RoleResponseDto',
      gqlPath: join(SRC, 'roles/dto/graphql/role-response.gql-dto.ts'),
      gqlClass: 'RoleResponseGqlDto',
    },
    {
      name: 'Permission',
      restPath: join(SRC, 'roles/dto/rest/role-response.dto.ts'),
      restClass: 'PermissionResponseDto',
      gqlPath: join(SRC, 'roles/dto/graphql/role-response.gql-dto.ts'),
      gqlClass: 'PermissionResponseGqlDto',
    },
    {
      name: 'User',
      restPath: join(SRC, 'users/dto/rest/user-response.dto.ts'),
      restClass: 'UserResponseDto',
      gqlPath: join(SRC, 'users/dto/graphql/user-response.gql-dto.ts'),
      gqlClass: 'UserResponseGqlDto',
      // REST serves these ids on its ENVELOPES — `CurrentUserResponseDto` and
      // `UserSummaryResponseDto` both carry `departmentIds` beside the user —
      // rather than on the flat user itself. GraphQL has no envelope to put them
      // on, so they sit on the type, next to the `departments` edge they index,
      // exactly as `Document.departmentIds` does.
      gqlOnly: ['departmentIds'],
    },
    {
      name: 'Document',
      restPath: join(SRC, 'documents/dto/rest/document-response.dto.ts'),
      restClass: 'DocumentResponseDto',
      gqlPath: join(SRC, 'documents/dto/graphql/document-response.gql-dto.ts'),
      gqlClass: 'DocumentResponseGqlDto',
      // `fileUrl` is an internal path, not a URL; `deletedById` is an audit field
      // with no edge behind it.
      //
      // `ocrLanguages` is REST-only BY DECISION. `@Field()` is
      // not inherited (conventions §12.2), so a GraphQL DTO would need its own
      // line; the field is an advanced upload option that no screen reads yet,
      // and adding it to the public schema before anything queries it is how a
      // schema accumulates fields nobody can remove.
      restOnly: ['fileUrl', 'deletedById', 'ocrLanguages'],
    },
    {
      name: 'Notification',
      restPath: join(
        SRC,
        'notifications/dto/rest/notification-response.dto.ts',
      ),
      restClass: 'NotificationResponseDto',
      gqlPath: join(
        SRC,
        'notifications/dto/graphql/notification-response.gql-dto.ts',
      ),
      gqlClass: 'NotificationResponseGqlDto',
      // `data` is an untyped bag — a JSON scalar in a schema is a hole where the
      // contract should be. `groupKey`/`groupCount` are internal coalescing state.
      restOnly: ['data', 'groupKey', 'groupCount'],
    },
    {
      // Paired only since the GraphQL side was renamed off `ApiInfo`: same three
      // fields, one build identity, two transports.
      name: 'Version',
      restPath: join(SRC, 'health/dto/rest/health-response.dto.ts'),
      restClass: 'VersionResponseDto',
      gqlPath: join(SRC, 'health/dto/graphql/version-response.gql-dto.ts'),
      gqlClass: 'VersionResponseGqlDto',
    },
    {
      name: 'Rate',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'RateResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'RateResponseGqlDto',
    },
    {
      name: 'Mean',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'MeanResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'MeanResponseGqlDto',
    },
    {
      name: 'AnalyticsOverview',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'OverviewResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'AnalyticsOverviewResponseGqlDto',
    },
    // ---------------------------------------- the three composed reads
    //
    // `agents`, `documents` and `knowledge-gaps` earned a GraphQL query because
    // their rows carry entity ids a loader can resolve. The chart series did
    // not, and have no GraphQL class to pair — which is why they are absent
    // here rather than listed with an empty contract.
    {
      name: 'UnavailableBlock',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'UnavailableBlockResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'UnavailableBlockResponseGqlDto',
    },
    {
      name: 'AgentStat',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'AgentStatResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'AgentStatResponseGqlDto',
      // The one field that could not stay. REST fills it from a hydration leg
      // called unconditionally; in GraphQL that leg IS the `agent` edge, so
      // carrying the name flat would mean paying for the round trip the edge
      // exists to avoid — and would give a client two ways to ask for the same
      // string, one of them never skippable.
      restOnly: ['fullName'],
    },
    {
      name: 'AgentAnalytics',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'AgentAnalyticsResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'AgentAnalyticsResponseGqlDto',
    },
    {
      name: 'DocumentUsage',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'DocumentUsageResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'DocumentUsageResponseGqlDto',
    },
    {
      name: 'DocumentAnalytics',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'DocumentAnalyticsResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'DocumentAnalyticsResponseGqlDto',
    },
    {
      name: 'KnowledgeGapFlag',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'KnowledgeGapFlagResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'KnowledgeGapFlagResponseGqlDto',
    },
    {
      name: 'KnowledgeGaps',
      restPath: join(SRC, 'analytics/dto/rest/analytics-response.dto.ts'),
      restClass: 'KnowledgeGapsResponseDto',
      gqlPath: join(SRC, 'analytics/dto/graphql/analytics-response.gql-dto.ts'),
      gqlClass: 'KnowledgeGapsResponseGqlDto',
    },
  ];

  /**
   * REST response shapes with **no GraphQL twin, on purpose**.
   *
   * **The sweep is organized by PAIRS, so a shape with no twin is invisible to
   * it.** That is not a small hole: `AiDraftResponseDto` sat outside every
   * assertion in this file while two of its fields were silently dropped by the
   * mapper, and the one mechanism built to flag a field nobody decided about
   * never looked at it. The same shape as a hand-written list agreeing with
   * whatever it was copied from.
   *
   * So the check below DISCOVERS response classes and requires each to be
   * either contracted above or named here with a reason. An entry is a decision
   * a reviewer can question; absence is now a failure rather than a silence.
   *
   * **Scoped to modules that have GraphQL DTOs at all.** In `auth` or `billing`
   * a twin is not merely absent but meaningless — there is no GraphQL surface
   * for those — and requiring forty entries saying so would bury the ones that
   * matter. Within a module the schema already covers, a shape with no twin is
   * a decision.
   */
  const TWINLESS: Readonly<Record<string, string>> = {
    // tickets — the co-pilot is a REST surface; no client reads drafts,
    // summaries or suggestions through the schema.
    // notifications — a device is a per-user SETTING managed from one screen,
    // not an entity anything queries by id or joins to. The token never leaves
    // the server, so there is nothing for a schema to expose either.
    DeviceTokenResponseDto: 'a settings-screen row, never a query',
    AiSummaryResponseDto: 'co-pilot output, REST-only surface',
    AiDraftResponseDto: 'co-pilot output, REST-only surface',
    AiSuggestionsResponseDto: 'co-pilot output, REST-only surface',
    // Envelopes and one-shot results rather than entities: nothing would query
    // them by id, which is what a GraphQL type is for.
    AttachmentResponseDto: 'nested inside MessageResponse, not queried alone',
    CreateMessageResponseDto: 'a write RESULT, not an entity',
    PresignAttachmentResponseDto: 'a short-lived credential, never a query',
    DownloadAttachmentResponseDto: 'a short-lived credential, never a query',
    BulkTicketStatusResponseDto: 'a write RESULT, not an entity',
    BulkTicketPriorityResponseDto: 'a write RESULT, not an entity',
    MarkTicketReadResponseDto: 'a write RESULT, not an entity',
    TicketStatusChangeResponseDto:
      'reached through Ticket, like AssignmentResponseDto beside it',
    AssignmentResponseDto: 'reached through Ticket, not queried alone',
    // departments
    DepartmentResponseDto: 'schema exposes departments through User and Ticket',
    DepartmentMemberResponseDto: 'a membership edge, resolved not queried',
    AddDepartmentMembersResponseDto: 'a write RESULT, not an entity',
    // documents
    DocumentChunkResponseDto: 'an ingestion internal, not a product shape',
    DocumentFlagResponseDto: 'operator diagnostics, REST-only',
    PresignDocumentResponseDto: 'a short-lived credential, never a query',
    DownloadDocumentResponseDto: 'a short-lived credential, never a query',
    StorageUsageResponseDto: 'a metered total, served beside billing',
    // notifications
    NotificationFeedResponseDto: 'an envelope around NotificationResponseDto',
    UnreadCountResponseDto: 'a scalar in a wrapper',
    MarkReadResponseDto: 'a write RESULT, not an entity',
    PreferenceResponseDto: 'settings, not a queried entity',
    // users
    PresignAvatarResponseDto: 'a short-lived credential, never a query',
    CurrentUserResponseDto: 'an envelope around UserResponseDto',
    UserSummaryResponseDto: 'an envelope around UserResponseDto',
    UserPermissionsResponseDto: 'a permission list, not an entity',
    // analytics — the schema exposes the OVERVIEW shapes (`Rate`, `Mean`,
    // `AnalyticsOverview`, …) and none of the time series behind them: a chart
    // series is read once for a dashboard, never resolved through an edge.
    DeflectionPointResponseDto: 'a time-series point, REST-only',
    DeflectionResponseDto: 'a time series, REST-only',
    ResponseTimePointResponseDto: 'a time-series point, REST-only',
    ResponseTimesResponseDto: 'a time series, REST-only',
    VolumePointResponseDto: 'a time-series point, REST-only',
    VolumeBreakdownResponseDto: 'nested inside VolumeResponseDto',
    VolumeResponseDto: 'a time series, REST-only',
    SatisfactionPointResponseDto: 'a time-series point, REST-only',
    SatisfactionResponseDto: 'a time series, REST-only',
    AiUsageSliceResponseDto: 'nested inside AiUsageResponseDto',
    AiUsagePointResponseDto: 'a time-series point, REST-only',
    AiUsageResponseDto: 'a time series, REST-only',
    ExportResponseDto: 'a download descriptor, never a query',
    // audit logs / documents — scalar lists in a wrapper
    AuditActionsResponseDto: 'a filter vocabulary, not an entity',
    // health probes — an orchestrator calls these, never a GraphQL client
    LivenessResponseDto: 'a k8s probe payload, not a product shape',
    ReadinessResponseDto: 'a k8s probe payload, not a product shape',
    ReadinessDependenciesResponseDto: 'nested inside ReadinessResponse',
    // Newly in scope: these gained the `Response` suffix, so the scan sees them.
    // All are nested rows or one-shot results, not entities a client queries.
    DraftCitationResponseDto:
      'nested inside AiDraftResponse, co-pilot REST-only',
    SuggestedArticleResponseDto:
      'nested inside AiSuggestionsResponse, REST-only',
    AiSuggestionResponseDto: 'nested inside AiSuggestionsResponse, REST-only',
    AiClassificationResponseDto: 'co-pilot output, REST-only surface',
    SimilarTicketResponseDto: 'co-pilot output, REST-only surface',
    BulkTicketFailureResponseDto: 'a per-row failure inside a bulk RESULT',
    RevokedSessionCountResponseDto: 'a write RESULT, not an entity',
    UntrustedDeviceCountResponseDto: 'a write RESULT, not an entity',
    DocumentDepartmentsResponseDto: 'an id list, reached through Document',
  };

  it('the contract list covers every paired shape', () => {
    // Guards the guard: an empty or truncated list passes every assertion below
    // while checking nothing.
    expect(CONTRACTS.map(({ name }) => name)).toEqual([
      'Ticket',
      'TicketMessage',
      'Citation',
      'IngestionJob',
      'Role',
      'Permission',
      'User',
      'Document',
      'Notification',
      'Version',
      'Rate',
      'Mean',
      'AnalyticsOverview',
      'UnavailableBlock',
      'AgentStat',
      'AgentAnalytics',
      'DocumentUsage',
      'DocumentAnalytics',
      'KnowledgeGapFlag',
      'KnowledgeGaps',
    ]);
  });

  it('**every response shape is contracted or declared twinless**', () => {
    // The assertion that would have asked somebody about `generationId`.
    //
    // Discovery is by class NAME (`*ResponseDto`), which is the convention this
    // codebase follows — a shape named otherwise escapes it, and that is the
    // known edge rather than a claim of completeness.
    const contracted = new Set(CONTRACTS.map(({ restClass }) => restClass));
    const modules = readdirSync(SRC).filter((name) =>
      existsSync(join(SRC, name, 'dto/graphql')),
    );

    const undeclared: string[] = [];
    for (const module of modules) {
      const restDir = join(SRC, module, 'dto/rest');
      if (!existsSync(restDir)) continue;

      for (const file of readdirSync(restDir).filter(
        (name) => name.endsWith('.dto.ts') && !name.endsWith('.spec.ts'),
      )) {
        const source = readFileSync(join(restDir, file), 'utf8');
        for (const [, className] of source.matchAll(
          /export class (\w*ResponseDto)\b/g,
        )) {
          if (!contracted.has(className) && !(className in TWINLESS)) {
            undeclared.push(`${module}/${file}: ${className}`);
          }
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('every twinless entry still exists', () => {
    // The other direction: a stale entry silently exempts nothing and makes the
    // list look more considered than it is.
    const sources = readdirSync(SRC)
      .filter((name) => existsSync(join(SRC, name, 'dto/rest')))
      .flatMap((name) =>
        readdirSync(join(SRC, name, 'dto/rest'))
          .filter((file) => file.endsWith('.dto.ts'))
          .map((file) =>
            readFileSync(join(SRC, name, 'dto/rest', file), 'utf8'),
          ),
      )
      .join('\n');

    const stale = Object.keys(TWINLESS).filter(
      (className) => !sources.includes(`export class ${className}`),
    );

    expect(stale).toEqual([]);
  });

  describe.each(CONTRACTS)('$name', (contract) => {
    const result = compareContract(contract);

    it('**every REST field is in the schema, or declared REST-only**', () => {
      // The drift the original inheritance claim missed entirely: present in
      // every REST response, invisible to every GraphQL client, nothing failing.
      expect(result.missingFromGql).toEqual([]);
    });

    it('**every schema field is in REST, or declared an edge**', () => {
      // The opposite direction, which the collapsed single class could not see:
      // a field reaching the PUBLIC schema because someone added `@Field()` to
      // something only REST was meant to serve.
      expect(result.missingFromRest).toEqual([]);
    });

    it('every property on the GraphQL class carries a `@Field()`', () => {
      // An undecorated property is simply absent from the SDL. Nothing errors;
      // the field just never reaches a client.
      expect(result.undecorated).toEqual([]);
    });

    it('and every `@Field()` names its GraphQL type explicitly', () => {
      // `number` cannot distinguish `Int` from `Float`, nor `string` an `ID`
      // from a `String`. Both serialize identically, so a wrong inference is
      // invisible until a client generates types from the schema.
      expect(result.inferredFields).toEqual([]);
    });

    it('**and `nullable` agrees with `| null` on both sides**', () => {
      // The half a field-set comparison cannot see, and the one whose failure
      // is out of all proportion to its cause: a field that becomes nullable in
      // REST and stays non-null here does not return one null field — the first
      // null row fails the WHOLE query with a non-null error, taking every
      // sibling's data with it.
      expect(result.nullabilityMismatches).toEqual([]);
    });
  });
});

describe('`searchTerm` is advertised on both transports or neither', () => {
  /**
   * The invariant known-gaps #6 left behind, and the one nothing checked.
   *
   * `searchTerm` used to live on `PageArgsGqlDto`, so every GraphQL args class
   * inherited it — including `IngestionJobsArgsGqlDto`, whose REST twin ignored
   * the parameter. The schema published `ingestionJobs(searchTerm:)`, validated
   * it, forwarded it through `toPageQuery`, and ingestion-service dropped it.
   * Nothing failed, because no test compared the two surfaces' ARGUMENTS — the
   * contracts above pair response shapes only.
   *
   * **Asked in one direction, deliberately.** The read-side rule is *a subset,
   * not a mirror*: GraphQL offering LESS than REST is allowed and sometimes
   * right. What is never right is GraphQL offering a filter REST refuses, which
   * is a second query surface with different capabilities — the thing
   * `IngestionJobsArgsGqlDto`'s own docblock names as the direction people
   * drift in.
   *
   * `restOnly` below is the declared other direction, in the same shape the
   * contract list uses: an asymmetry that is written down cannot be confused
   * with one that was forgotten.
   */
  const acceptsSearchTerm = async (Dto: new () => object): Promise<boolean> => {
    // Exactly what the global `ValidationPipe` does — `whitelist` +
    // `forbidNonWhitelisted` is what turns an unknown property into a 400. Asked
    // of the CLASS rather than of its source, so `OmitType`, inheritance and a
    // hand-written field all answer the same way.
    const errors = await validate(
      plainToInstance(
        Dto,
        { searchTerm: 'x' },
        { enableImplicitConversion: true },
      ),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    return !errors.some((error) => error.property === 'searchTerm');
  };

  const PAIRS: readonly {
    name: string;
    rest: new () => object;
    gql: new () => object;
    /** Declared REST-only: the ALLOWED direction, and never inferred. */
    restOnly?: boolean;
  }[] = [
    {
      name: 'Ticket',
      rest: ListTicketsQueryDto,
      gql: TicketsArgsGqlDto,
      // REST-only BY DECISION. `tickets.service.ts` filters on it, and
      // `TicketsArgsGqlDto` is hand-written as a narrower surface — the allowed
      // direction. Removing this entry should fail, not pass.
      restOnly: true,
    },
    {
      name: 'IngestionJob',
      rest: ListIngestionJobsQueryDto,
      gql: IngestionJobsArgsGqlDto,
    },
    {
      name: 'Document',
      rest: ListDocumentsQueryDto,
      gql: SearchPageArgsGqlDto,
    },
    { name: 'User', rest: ListUsersQueryDto, gql: SearchPageArgsGqlDto },
    { name: 'Role', rest: ListRolesQueryDto, gql: SearchPageArgsGqlDto },
    {
      name: 'Department',
      rest: ListDepartmentsQueryDto,
      gql: SearchPageArgsGqlDto,
    },
  ];

  it('the two base classes still differ, which is what the split is', async () => {
    // Vacuity guard. If `searchTerm` crept back onto the plain base, every
    // assertion below would pass while checking nothing — which is exactly the
    // state this row started in.
    await expect(acceptsSearchTerm(PageArgsGqlDto)).resolves.toBe(false);
    await expect(acceptsSearchTerm(SearchPageArgsGqlDto)).resolves.toBe(true);
  });

  it.each(PAIRS)(
    '$name — GraphQL never advertises a filter REST refuses',
    async ({ rest, gql, restOnly }) => {
      const onRest = await acceptsSearchTerm(rest);
      const onGql = await acceptsSearchTerm(gql);

      // The direction that is always wrong.
      expect({ onRest, onGql: onGql && !onRest }).toEqual({
        onRest,
        onGql: false,
      });

      // And the other direction is allowed only where it is declared.
      if (!restOnly) expect(onGql).toBe(onRest);
    },
  );
});
