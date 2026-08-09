import { RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';

/**
 * Routes served OUTSIDE the versioned API prefix — 23-doc §1, §3.
 *
 * `/api/v1` is a contract offered to API clients, and an orchestrator is not
 * one: it has no credentials, no version negotiation and no ability to follow a
 * migration. Versioning a probe means a future `/api/v2` silently moves it, and
 * the symptom is every instance failing its readiness check immediately after a
 * deploy that changed nothing about health.
 *
 * Declared once and shared by `main.ts` and both test bootstraps, because the
 * failure of getting it wrong in only one of them is a suite that passes against
 * paths production does not serve.
 */
export const OPS_ROUTES: RouteInfo[] = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'health/ready', method: RequestMethod.GET },
  { path: 'version', method: RequestMethod.GET },
];
