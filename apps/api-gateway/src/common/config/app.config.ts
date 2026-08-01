export const MIN_FULL_NAME_LENGTH = 2;
export const MAX_FULL_NAME_LENGTH = 150;

export const MAX_DEVICE_NAME_LENGTH = 100;

/**
 * Upper bound on one invitation batch.
 *
 * Guards the REQUEST BODY, not the seat quota — `organizations.max_agent_seats`
 * is what limits how many invitations may actually exist, and auth-service
 * enforces that. This only stops a single call arriving with 50,000 addresses.
 */
export const MAX_INVITATIONS_PER_BATCH = 200;

export const SORT_ORDER_OPTIONS = ['ASC', 'DESC'] as const;
export type SortOrder = (typeof SORT_ORDER_OPTIONS)[number];

export const DEFAULT_SEARCH = {
  PAGE: 1,
  LIMIT: 10,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  SORT_BY: 'createdAt',
  SORT_ORDER: 'ASC' satisfies SortOrder,
} as const;

export type ApiSuccessResponse<T = any> = {
  success: boolean;
  statusCode: number;
  message: string;
  warning: string | null;
  data: T;
};

export type ApiErrorResponse = {
  success: boolean;
  statusCode: number;
  path: string;
  timestamp: string;
  error: string;
};
