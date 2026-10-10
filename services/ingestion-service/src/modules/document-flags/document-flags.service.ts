import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  DeleteDocumentFlagResponse,
  DocumentFlagResponse,
  ListDocumentFlagsRequest,
  ListDocumentFlagsResponse,
  emptyPage,
  fromProtoDocumentFlagSeverity,
  fromProtoDocumentFlagType,
  toPageMeta,
  toPrismaPage,
} from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  CallerContext,
  DOCUMENT_FLAG_SORTABLE_FIELDS,
  DocumentFlagResolution,
  DocumentFlagType,
  requireActor,
  requireTenant,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { documentVisibility } from '../../common/document-visibility';
import { Prisma } from '../../generated/prisma/client';
import {
  DOCUMENT_FLAG_INCLUDE,
  toDocumentFlagResponse,
} from './document-flag.mapper';

/** `document_flags`, scoped to what the caller may see. */
@Injectable()
export class DocumentFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
  ) {}

  /**
   * The flag worklist.
   *
   * **Accepts EVERY flag type, and more than one at a time.** `UNRETRIEVED` and
   * `UNCITED` were one flag under a name that fitted only `UNRETRIEVED`, and
   * they were split because they are different findings with different fixes: a
   * document nobody's question came near may simply be mis-titled, while one
   * retrieved twenty times and cited never is actively displacing the sources
   * that would have answered. A filter that accepted only one of them would
   * quietly re-merge them, because a type nobody can select is a type nobody
   * sees.
   *
   * Unresolved by default: a resolved flag is history, and mixing history into
   * a worklist is how a worklist stops being read.
   */
  async listDocumentFlags(
    request: ListDocumentFlagsRequest,
    context: CallerContext,
  ): Promise<ListDocumentFlagsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DOCUMENT_FLAG_SORTABLE_FIELDS,
    );

    const where: Prisma.DocumentFlagWhereInput = {
      ...this.scope(context),
      ...this.typeFilter(request),
      // UNSPECIFIED (0) is falsy and means "no filter", so `fromProto*`
      // returning null and the field being absent are the same thing.
      ...(fromProtoDocumentFlagSeverity(request.severity)
        ? { severity: fromProtoDocumentFlagSeverity(request.severity)! }
        : {}),
      ...(request.documentId ? { documentId: request.documentId } : {}),
      ...(request.includeResolved ? {} : { resolvedAt: null }),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.documentFlag.findMany({
        where,
        orderBy,
        skip,
        take,
        include: DOCUMENT_FLAG_INCLUDE,
      }),
      // The SAME `where`. A count computed without the scope would tell a
      // caller how many flags exist that they cannot see.
      this.prisma.documentFlag.count({ where }),
    ]);

    return {
      items: items.map(toDocumentFlagResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * One flag, with everything the detail view needs.
   *
   * @throws RpcException NOT_FOUND when this caller has no such flag.
   */
  async getDocumentFlag(
    id: string,
    context: CallerContext,
  ): Promise<DocumentFlagResponse> {
    return toDocumentFlagResponse(await this.load(id, context));
  }

  /**
   * Removes a flag row outright.
   *
   * **For a row that should not exist** — a bad detector run, a test artefact.
   * It is not how a finding is made to go away: deleting the row also deletes
   * the exclusion `raise()` reads, so for a SWEPT type (`UNRETRIEVED`,
   * `UNCITED`) the next detection cycle raises it again. `PAGES_NOT_INDEXED`
   * returns when the document is re-ingested, and the four types with no
   * detector never return. Dismiss is what suppresses a finding.
   *
   * @throws RpcException NOT_FOUND when this caller has no such flag.
   */
  async deleteDocumentFlag(
    id: string,
    context: CallerContext,
  ): Promise<DeleteDocumentFlagResponse> {
    const flag = await this.load(id, context);

    // By id alone, and safely: `load` has already proved this row is one the
    // caller may act on, which is the check `delete({ where: { id } })` cannot
    // express by itself.
    await this.prisma.documentFlag.delete({ where: { id: flag.id } });

    // **The ONLY trace left**: the row is gone and this table has no
    // `deleted_at`. Every other action has a surviving row to corroborate it;
    // this one does not, which makes the delete path the first case that would
    // justify revisiting `AuditPublisher`'s at-most-once trade — JetStream plus
    // a durable consumer on both ends, as `AuditConsumer`'s docblock describes.
    // A broker outage here loses the flag AND the record that it existed.
    this.audit.record(context, {
      action: AuditAction.DOCUMENT_FLAG_DELETED,
      resourceType: AuditResourceType.DOCUMENT_FLAG,
      resourceId: flag.id,
      // Names what was destroyed; does not reproduce it. `resolution` and
      // `resolvedById` answer "whose decision was deleted" — deleting a
      // dismissed flag otherwise loses that it had been dismissed at all.
      //
      // `resolutionComment` must NOT join them: a test asserts the trail
      // carries no comment prose, and that is the contract, not an oversight.
      metadata: {
        documentId: flag.documentId,
        flagType: flag.flagType,
        resolution: flag.resolution,
        resolvedById: flag.resolvedById,
      },
    });

    return { deleted: true };
  }

  /**
   * Marks a flag handled, recording WHO.
   *
   * `resolved_by_id` is what turns "this flag is closed" into "a person closed
   * this flag", which is the difference between a dismissal the sweep must
   * respect and a state it could reasonably re-derive.
   *
   * @throws RpcException NOT_FOUND when this caller has no such flag.
   */
  async resolve(
    id: string,
    resolution: DocumentFlagResolution,
    context: CallerContext,
    comment?: string,
  ): Promise<DocumentFlagResponse> {
    // Here rather than only at the gateway DTO: the rule is about what a
    // dismissal MEANS — the next person to see this flag return needs to read
    // why it was waved off last time — so it belongs where the write is, and
    // holds for any caller of this service.
    if (resolution === DocumentFlagResolution.DISMISSED && !comment?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Dismissing a flag requires a reason',
      });
    }

    const flag = await this.load(id, context);

    // **Resolution is once.** The update below is unconditional, so without
    // this a second resolve overwrites `resolvedAt`, `resolution`,
    // `resolvedById` and the comment — and re-dismissing on day 29 would start
    // a fresh suppression window, making the bounded window §2 argued for
    // unbounded again through the API that was supposed to bound it.
    //
    // The correction path is DELETE, which needs `document.delete` rather than
    // `document.update`. That asymmetry is deliberate: undoing a recorded human
    // decision is a bigger act than making one.
    if (flag.resolvedAt) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        // Names the existing resolution: it tells the caller whether they need
        // the delete path at all, and `load` has already fetched it.
        message: flag.resolution
          ? `This flag was already resolved as ${flag.resolution}`
          : 'This flag has already been resolved',
      });
    }

    const resolved = await this.prisma.documentFlag.update({
      where: { id: flag.id },
      data: {
        resolvedAt: new Date(),
        resolvedById: requireActor(context),
        resolution,
        resolutionComment: comment?.trim() || null,
      },
      include: DOCUMENT_FLAG_INCLUDE,
    });

    // DISMISSED gets its own action: it is the only resolution that SUPPRESSES
    // the detector, so "who silenced this, and why" is a different question
    // from "who marked it handled".
    this.audit.record(context, {
      action:
        resolution === DocumentFlagResolution.DISMISSED
          ? AuditAction.DOCUMENT_FLAG_DISMISSED
          : AuditAction.DOCUMENT_FLAG_RESOLVED,
      resourceType: AuditResourceType.DOCUMENT_FLAG,
      resourceId: resolved.id,
      // The flag TYPE and the document, never the comment: the row already
      // holds the comment, and an audit trail is not a second copy of tenant
      // prose.
      metadata: {
        documentId: resolved.documentId,
        flagType: resolved.flagType,
        resolution,
      },
    });

    return toDocumentFlagResponse(resolved);
  }

  /**
   * One flag, scoped.
   *
   * @throws RpcException NOT_FOUND when no row matches — including a flag on a
   * document this caller may not see.
   */
  private async load(id: string, context: CallerContext) {
    // `findFirst`, never `findUnique`: the latter takes only unique fields and
    // cannot express the tenant filter (known-gaps #1), which is exactly how
    // the old `resolve()` would have let any tenant resolve any flag by id.
    const flag = await this.prisma.documentFlag.findFirst({
      where: { id, ...this.scope(context) },
      include: DOCUMENT_FLAG_INCLUDE,
    });

    if (!flag) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Document flag not found',
      });
    }

    return flag;
  }

  /**
   * The requested types, refused rather than ignored when one is unknown.
   *
   * **The membership check stays, and the enum did not make it redundant.**
   * protoc refuses an unknown value from a peer that shares this contract, but
   * ts-proto maps anything it cannot name to `UNRECOGNIZED` (-1) rather than
   * failing — so a newer build's flag type arrives here as a legal value of the
   * enum type that this build cannot act on. `fromProto*` answers null for
   * exactly that case, and null is what this rejects.
   *
   * @throws RpcException INVALID_ARGUMENT naming every unknown value. Silently
   * dropping the filter answers a DIFFERENT question than the one asked, and a
   * caller reading "no OUTDATED flags" as "nothing is outdated" is the whole
   * failure.
   */
  private typeFilter(
    request: ListDocumentFlagsRequest,
  ): Prisma.DocumentFlagWhereInput {
    const requested: DocumentFlagType[] = [];
    const unknown: number[] = [];

    for (const flagType of request.flagTypes ?? []) {
      const domain = fromProtoDocumentFlagType(flagType);
      if (domain) requested.push(domain);
      else unknown.push(flagType);
    }

    if (unknown.length > 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Unknown flag type(s): ${unknown.join(', ')}`,
      });
    }

    return requested.length > 0 ? { flagType: { in: requested } } : {};
  }

  /** The tenant, soft-delete and visibility predicates every query here repeats. */
  private scope(context: CallerContext): Prisma.DocumentFlagWhereInput {
    return {
      organizationId: requireTenant(context),
      // A flag names a document, so an unscoped list leaks another tenant's
      // titles through the join — and `documentVisibility` is what keeps a
      // department-scoped document out of a worklist for a caller
      // `GET /documents/:id` would answer NOT_FOUND (ADR 0037).
      document: { deletedAt: null, ...documentVisibility(context) },
    };
  }
}
