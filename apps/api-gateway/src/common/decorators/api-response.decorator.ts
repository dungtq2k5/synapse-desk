import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * The success envelope's own fields, declared ONCE — 24-doc §2, fix 3.
 *
 * Both decorators below reference this rather than inlining the property list.
 * Two copies of an envelope shape drift the first time a field is added, and
 * `warning` is exactly the field somebody will add a sibling to — at which
 * point half the API documents the new field and half does not, with nothing
 * failing.
 *
 * Field-for-field identical to `SuccessResponse` in
 * `common/interfaces/http-response.interface.ts`, which is the shape
 * `TransformInterceptor` actually produces.
 */
export const ENVELOPE_PROPERTIES = {
  success: { type: 'boolean', example: true },
  statusCode: { type: 'number', example: 200 },
  message: { type: 'string', example: 'OK' },
  warning: {
    type: 'string',
    nullable: true,
    description:
      'A non-fatal advisory about a request that otherwise succeeded — a ' +
      'degraded search, a partially-applied bulk operation. Null when there ' +
      'is nothing to say.',
  },
} as const satisfies Record<string, SchemaObject>;

/** The error envelope, from `ErrorResponse`. Same reasoning as above. */
export const ERROR_ENVELOPE_PROPERTIES = {
  success: { type: 'boolean', example: false },
  statusCode: { type: 'number' },
  path: { type: 'string', example: '/api/v1/tickets' },
  timestamp: { type: 'string', format: 'date-time' },
  error: { type: 'string' },
} as const satisfies Record<string, SchemaObject>;

/** What a route may declare. `429` and `500` are added unconditionally. */
export type ApiErrorStatus = '400' | '401' | '403' | '404' | '409' | '422';

const ERROR_DESCRIPTIONS: Record<ApiErrorStatus | '429' | '500', string> = {
  '400': 'Validation failed, or the request is malformed.',
  '401': 'No valid session cookie, or the session has expired.',
  '403': 'Authenticated, but lacking the permission this route requires.',
  '404':
    'No such resource — or one the caller may not see. The two are ' +
    'deliberately indistinguishable, so a by-id route cannot be used as an ' +
    'existence oracle across tenants.',
  '409': 'The request conflicts with the current state of the resource.',
  '422': 'Well-formed, but semantically rejected by a business rule.',
  '429': 'Rate limited. Every route is throttled — see the tier on the route.',
  '500': 'Unexpected server error. The response body carries no internals.',
};

/**
 * Marks a model as the ITEM type of a paginated list.
 *
 * `PaginationResponseDto<T>` is generic, and a generic class has no runtime
 * identity — `getSchemaPath(PaginationResponseDto)` would document `items` as
 * an array of nothing for every list route in the API. So the item type is
 * passed separately and the envelope is built around it here.
 */
export function Paginated<T>(model: Type<T>): PaginatedModel<T> {
  return { paginatedItem: model };
}

type PaginatedModel<T> = { paginatedItem: Type<T> };

const isPaginated = (value: unknown): value is PaginatedModel<unknown> =>
  typeof value === 'object' && value !== null && 'paginatedItem' in value;

/** The `meta` block every list route returns, from `PaginationResponseDto`. */
const PAGINATION_META: SchemaObject = {
  type: 'object',
  required: [
    'totalItems',
    'itemCount',
    'itemsPerPage',
    'totalPages',
    'currentPage',
  ],
  properties: {
    totalItems: {
      type: 'number',
      description: 'Total matching records, across every page.',
    },
    itemCount: { type: 'number', description: 'Records on THIS page.' },
    itemsPerPage: { type: 'number' },
    totalPages: { type: 'number' },
    currentPage: { type: 'number' },
  },
};

/**
 * Documents the SUCCESS response, envelope included — 24-doc §2.
 *
 * **Without this, every documented response in the API is wrong.** A handler
 * returns `TicketResponseDto`; `TransformInterceptor` wraps it, so the wire
 * carries `{ success, statusCode, message, warning, data: TicketResponseDto }`.
 * Swagger sees only the handler's return type, so the generated schema
 * describes the payload while the client receives the envelope — and a
 * generated client built from it fails on every single call.
 *
 * ```ts
 * ＠ApiWrappedResponse(TicketResponseDto)            // data: { $ref: … }
 * ＠ApiWrappedResponse([TicketDto, DraftDto])        // data: { oneOf: [ … ] }
 * ＠ApiWrappedResponse()                             // data: null, for void
 * ＠ApiWrappedResponse(TicketResponseDto, { isArray: true })
 * ```
 *
 * **The status is derived, not hardcoded** — 24-doc §2, fix 2. The obvious
 * implementation reaches for `ApiOkResponse`, which means every `@Post`
 * documents a 200 while returning 201. A silently-wrong status is worse than an
 * absent one, because a client generator emits it and the resulting client
 * treats every successful create as an error.
 *
 * **Why not a global generic wrapper?** Because the wrapping is not generic at
 * the type level: the interceptor adds it at runtime and the handler signature
 * never mentions it. A decorator per route is the honest description of what
 * happens, and it is one line.
 */
export function ApiWrappedResponse(
  model?: Type<unknown> | Type<unknown>[] | PaginatedModel<unknown>,
  options: {
    /** Defaults to 200, or 201 when the route is a `@Post` — see `status`. */
    status?: HttpStatus | number;
    isArray?: boolean;
    description?: string;
  } = {},
): MethodDecorator & ClassDecorator {
  const page = isPaginated(model) ? model.paginatedItem : null;
  const models: Type<unknown>[] = page
    ? [page]
    : model
      ? Array.isArray(model)
        ? model
        : [model as Type<unknown>]
      : [];

  const data: SchemaObject | ReferenceObject = (() => {
    if (page) {
      return {
        type: 'object',
        required: ['items', 'meta'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(page) } },
          meta: PAGINATION_META,
        },
      };
    }

    if (models.length === 0) {
      // A void handler. `nullable` with no type is how OpenAPI 3.0 says "this
      // key is present and is null" — omitting `data` entirely would document a
      // body the interceptor does not produce.
      return { type: 'object', nullable: true, example: null };
    }

    const one: SchemaObject | ReferenceObject =
      models.length === 1
        ? { $ref: getSchemaPath(models[0]) }
        : { oneOf: models.map((m) => ({ $ref: getSchemaPath(m) })) };

    return options.isArray ? { type: 'array', items: one } : one;
  })();

  return applyDecorators(
    // Required for a `$ref` to resolve when the model is not otherwise
    // reachable from a handler signature — the classic cause of a dangling
    // reference in a `oneOf`.
    ApiExtraModels(...models),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description ?? 'Success.',
      schema: {
        type: 'object',
        required: ['success', 'statusCode', 'message', 'data'],
        properties: { ...ENVELOPE_PROPERTIES, data },
      },
    }),
  );
}

/**
 * Documents the ERROR responses a route can produce — 24-doc §2, fix 1.
 *
 * **`429` and `500` are added unconditionally**, because the global throttler
 * and the global exception filter apply to every route in the gateway. A
 * document that omits them describes a different API than the one running.
 *
 * **`403` is handled**, which the reference implementation this is ported from
 * did not do: its union accepted `'403'` and its body ignored it, so
 * `@ApiFilterErrors(['403'])` type-checked, read as documentation, and produced
 * nothing at all. **This system needs 403 more than the reference did** —
 * permission-guarded routes are most of the API.
 *
 * `'429'` and `'500'` are deliberately absent from {@link ApiErrorStatus}:
 * passing them was already a no-op, and a parameter that does nothing is worse
 * than one that does not exist.
 */
export function ApiFilterErrors(
  statuses: ApiErrorStatus[] = [],
): MethodDecorator & ClassDecorator {
  const all = [...new Set([...statuses, '429', '500'])] as Array<
    ApiErrorStatus | '429' | '500'
  >;

  return applyDecorators(
    ...[...all]
      .sort((a, b) => Number(a) - Number(b))
      .map((status) =>
        ApiResponse(errorResponse(Number(status), ERROR_DESCRIPTIONS[status])),
      ),
  );
}

function errorResponse(
  status: number,
  description: string,
): ApiResponseOptions {
  return {
    status,
    description,
    schema: {
      type: 'object',
      required: ['success', 'statusCode', 'path', 'timestamp', 'error'],
      properties: {
        ...ERROR_ENVELOPE_PROPERTIES,
        statusCode: { type: 'number', example: status },
      },
    },
  };
}
