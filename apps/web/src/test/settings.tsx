import type {
  OrganizationResponseDto,
  OrganizationSettingsResponseDto,
} from '@synapsedesk/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ok } from './api';
import './dom';

/**
 * What the Settings specs share: a query client that doesn't retry, the
 * signed-in viewer holding exactly some permissions, and the organization the
 * pages read.
 *
 * @example
 * stubApi({ ...viewer(['organization.read']), ... });
 * renderSettings(<OrganizationView />);
 */
export function renderSettings(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

/** `GET /users/me` as a viewer holding `codes`. */
export function viewer(codes: string[], id = 'maya') {
  return {
    'GET /api/v1/users/me': ok({
      user: { id, fullName: 'Maya Chen', email: 'maya@acme.test' },
      permissionCodes: codes,
      departmentIds: [],
    }),
  };
}

/** A page of `items`, with the meta the lists read. */
export function paged(items: unknown[], total = items.length, perPage = 20) {
  return ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: perPage,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      itemCount: items.length,
    },
  });
}

export const ORGANIZATION: OrganizationResponseDto = {
  id: 'org',
  name: 'Acme',
  slug: 'acme',
  domain: 'acme.test',
  status: 'ACTIVE',
  enforceTwoFactor: false,
  allowedEmailDomains: ['acme.test'],
  maxAgentSeats: 20,
  maxStorageBytes: 5 * 1024 ** 3,
  monthlyAiTokenBudget: 1_000_000,
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  analyticsRangeDays: 180,
  createdAt: '2026-01-10T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

export const SETTINGS: OrganizationSettingsResponseDto = {
  enforceTwoFactor: false,
  allowedEmailDomains: ['acme.test'],
  publicDomainWarnings: [],
  inboundAddress: null,
  maxDocumentBytesOverride: null,
  maxAttachmentBytesOverride: null,
  maxAttachmentsPerMessageOverride: null,
};

/** jsdom has no `matchMedia`; the shell's hooks ask it. */
export function stubMatchMedia() {
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // next-themes still listens the old way.
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}
