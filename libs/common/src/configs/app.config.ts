export const NODE_ENV_OPTIONS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENV_OPTIONS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export enum Gender {
  UNSPECIFIED = 'UNSPECIFIED',
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export enum OrgStatus {
  PENDING_ONBOARDING = 'PENDING_ONBOARDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED_PAST_DUE = 'SUSPENDED_PAST_DUE',
  FROZEN = 'FROZEN',
}
