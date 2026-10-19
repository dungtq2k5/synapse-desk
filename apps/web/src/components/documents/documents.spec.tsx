import type {
  DocumentFlagResponseDto,
  DocumentResponseDto,
  IngestionJobResponseDto,
} from '@synapsedesk/api-client';
import { REALTIME_EVENTS } from '@synapsedesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fail, ok, stubApi } from '@/test/api';
import { lastSocket } from '@/test/socket';
import { DocumentView } from './document-view';
import { DocumentsView } from './documents-view';
import { FlagCard } from './flag-card';
import { UploadButton } from './upload-dialog';

jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/shell/app-header', () => ({
  AppHeader: ({ crumbs }: { crumbs: { label: string }[] }) => (
    <nav aria-label="Breadcrumb">
      {crumbs.map((crumb) => crumb.label).join(' / ')}
    </nav>
  ),
}));

beforeAll(() => {
  window.matchMedia = ((media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const MANAGER = [
  'document.read',
  'document.create',
  'document.update',
  'document.share',
  'document.reindex',
  'document.delete',
  'department.read',
  'user.read',
];

const doc = (over: Partial<DocumentResponseDto> = {}): DocumentResponseDto => ({
  id: 'd1',
  organizationId: 'o1',
  createdById: 'maya',
  title: 'Remote Work Policy.pdf',
  fileUrl: 'organizations/o1/documents/x/y.pdf',
  fileType: 'pdf',
  ocrLanguages: ['en'],
  fileSizeBytes: 2_516_582,
  isOrganizationWide: true,
  status: 'INDEXED',
  departmentIds: [],
  chunkCount: 48,
  createdAt: '2026-09-12T09:00:00Z',
  updatedAt: '2026-10-02T14:08:00Z',
  deletedAt: null,
  deletedById: null,
  ...over,
});

const job = (
  over: Partial<IngestionJobResponseDto> = {},
): IngestionJobResponseDto => ({
  id: 'j1',
  documentId: 'd1',
  bullmqJobId: '',
  status: 'COMPLETED',
  errorLog: null,
  errorCode: null,
  failedStage: null,
  waitingReason: null,
  processedAt: '2026-10-02T14:08:00Z',
  createdAt: '2026-10-02T14:02:00Z',
  ...over,
});

const page = (items: unknown[]) =>
  ok({
    items,
    meta: {
      totalItems: items.length,
      itemCount: items.length,
      itemsPerPage: 8,
      totalPages: 1,
      currentPage: 1,
    },
  });

function show(
  ui: ReactNode,
  codes: string[],
  routes: Parameters<typeof stubApi>[0] = {},
) {
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: { id: 'maya', fullName: 'Maya Chen', email: 'maya@acme.test' },
      permissionCodes: codes,
      departmentIds: [],
    }),
    'GET /api/v1/users': ok({
      items: [{ user: { id: 'maya', fullName: 'Maya Chen' } }],
      meta: {},
    }),
    'GET /api/v1/departments': page([
      { id: 'hr', name: 'HR' },
      { id: 'it', name: 'IT support' },
    ]),
    'GET /api/v1/organizations/current': ok({ name: 'Northwind Health' }),
    'GET /api/v1/documents/flags': page([]),
    'GET /api/v1/documents/storage': ok({
      usedBytes: 1024,
      limitBytes: 5 * 1024 ** 3,
      documentCount: 1,
    }),
    ...routes,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RealtimeProvider>
        <TooltipProvider>
          {ui}
          <Toaster />
        </TooltipProvider>
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  act(() => lastSocket().receive(REALTIME_EVENTS.connectionReady));
  // `applyAccept: false`: a person can drop any file, whatever `accept` says.
  return { calls, user: userEvent.setup({ applyAccept: false }) };
}

describe('the documents list', () => {
  it('is not there for a reader without document.read', async () => {
    show(<DocumentsView />, ['ticket.create']);

    expect(
      await screen.findByRole('heading', { name: 'This page isn’t available' }),
    ).toBeInTheDocument();
  });

  it('shows a read-only manager the list, and no Upload or row actions', async () => {
    const { user } = show(<DocumentsView />, ['document.read'], {
      'GET /api/v1/documents': page([doc()]),
    });

    await screen.findAllByRole('link', { name: 'Remote Work Policy.pdf' });
    expect(
      screen.queryByRole('button', { name: 'Upload' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: 'Show deleted' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getAllByRole('button', {
        name: 'Actions for Remote Work Policy.pdf',
      })[0],
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Open' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Delete' }),
    ).not.toBeInTheDocument();
  });

  it('a replace in progress reads "Updating"; a job at the AI cap says it waits', async () => {
    show(<DocumentsView />, MANAGER, {
      'GET /api/v1/documents': page([
        doc({ id: 'd1', status: 'PROCESSING' }),
        doc({
          id: 'd2',
          title: 'IT Returns.txt',
          status: 'PENDING',
          fileType: 'txt',
        }),
      ]),
      'GET /api/v1/documents/d1/ingestion-jobs': page([
        job({ id: 'a' }),
        job({ id: 'b', status: 'PARSING', processedAt: null }),
      ]),
      'GET /api/v1/documents/d2/ingestion-jobs': page([
        job({
          id: 'c',
          documentId: 'd2',
          status: 'QUEUED',
          waitingReason: 'AI_ALLOWANCE',
          processedAt: null,
        }),
      ]),
    });

    expect(
      (
        await screen.findAllByText(
          'Updating — answers use the current version until the new one is ready',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText('Waiting for the AI allowance to reset'))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Not searchable yet').length).toBeGreaterThan(0);
  });

  it('at full storage, Upload is off and points at why; billing only for organization.update', async () => {
    show(<DocumentsView />, MANAGER, {
      'GET /api/v1/documents': page([doc()]),
      'GET /api/v1/documents/storage': ok({
        usedBytes: 5 * 1024 ** 3,
        limitBytes: 5 * 1024 ** 3,
        documentCount: 23,
      }),
    });

    const upload = await screen.findByRole('button', { name: 'Upload' });
    await waitFor(() => expect(upload).toBeDisabled());
    const alert = document.getElementById(
      upload.getAttribute('aria-describedby')!,
    );
    expect(alert).toHaveTextContent('Storage is full');
    expect(alert).toHaveTextContent('Ask an administrator to change the plan.');
  });
});

describe('uploading', () => {
  it('refuses a file by its type before sending; a 402 keeps the server’s sentence and holds the rest', async () => {
    const { user, calls } = show(<UploadButton />, MANAGER, {
      'POST /api/v1/documents/presign': fail(
        402,
        'Your document storage is full. New uploads will be refused until space is freed or your plan is changed!',
      ),
    });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = await screen.findByRole('dialog');
    const input = dialog.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, [
      new File(['%PDF'], 'Policy.pdf', { type: 'application/pdf' }),
      new File(['# x'], 'FAQ.md'),
      new File(['x'], 'Deck.pptx'),
    ]);

    expect(
      within(dialog).getByText(
        'PowerPoint files can’t be uploaded. Use PDF, Word, Markdown or text.',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Upload 2 documents' }),
    );

    expect(
      await within(dialog).findByText(
        'Your document storage is full. New uploads will be refused until space is freed or your plan is changed.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Storage is full.')).toBeInTheDocument();
    expect(within(dialog).getByText('Not uploaded yet.')).toBeInTheDocument();
    // One presign: the batch stopped at the plan limit.
    expect(calls.filter((call) => call.url.endsWith('/presign'))).toHaveLength(
      1,
    );
  });

  it('asks for at least one department before sending', async () => {
    const { user, calls } = show(<UploadButton />, MANAGER);
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      dialog.querySelector('input[type="file"]') as HTMLInputElement,
      [new File(['# x'], 'FAQ.md')],
    );
    await user.click(
      within(dialog).getByRole('radio', { name: 'Only some departments' }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Upload 1 document' }),
    );

    expect(
      within(dialog).getByText('Choose at least one department.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/presign'))).toBe(false);
  });
});

describe('one document', () => {
  it('a failure stops the stepper at its stage and says it plainly, with only the actions that help', async () => {
    show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(doc({ status: 'FAILED', chunkCount: 0 })),
      'GET /api/v1/documents/d1/ingestion-jobs': page([
        job({
          status: 'FAILED',
          errorCode: 'NO_READABLE_TEXT',
          failedStage: 'PARSING',
          errorLog: 'OCR found no readable text in this document.',
        }),
      ]),
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Processing failed');
    expect(alert).toHaveTextContent(
      'We couldn’t find readable text, even with OCR.',
    );
    expect(
      within(alert).getByRole('button', { name: 'Replace file' }),
    ).toBeInTheDocument();
    expect(
      within(alert).queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    const parsing = screen.getByText('Parsing').closest('li')!;
    expect(parsing).toHaveTextContent('Failed');
    expect(screen.getByText('Chunking').closest('li')).toHaveTextContent(
      'Waiting',
    );
  });

  it('a share-only manager cannot switch between everyone and departments, and says why', async () => {
    show(
      <DocumentView documentId="d1" />,
      ['document.read', 'document.share', 'department.read'],
      {
        'GET /api/v1/documents/d1': ok(
          doc({ isOrganizationWide: false, departmentIds: ['it'] }),
        ),
        'GET /api/v1/documents/d1/ingestion-jobs': page([job()]),
        'GET /api/v1/documents/d1/chunks': page([]),
      },
    );

    const everyone = await screen.findByRole('radio', {
      name: 'Everyone in Northwind Health',
    });
    expect(everyone).toBeDisabled();
    expect(
      screen.getByText(
        'Only people who can edit documents can switch between everyone and departments.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove IT support' }),
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Replace file' }),
    ).not.toBeInTheDocument();
  });

  it('without user.read, Details says "Uploaded" over the date alone', async () => {
    show(
      <DocumentView documentId="d1" />,
      MANAGER.filter((code) => code !== 'user.read'),
      {
        'GET /api/v1/documents/d1': ok(doc()),
        'GET /api/v1/documents/d1/ingestion-jobs': page([job()]),
      },
    );

    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByText('Uploaded')).toBeInTheDocument();
    expect(within(details).queryByText('Uploaded by')).not.toBeInTheDocument();
    expect(within(details).getByText('12 Sept 2026')).toBeInTheDocument();
  });

  it('a reader without document.read gets "Document not found"', async () => {
    show(<DocumentView documentId="d1" />, ['ticket.create']);

    expect(
      await screen.findByRole('heading', { name: 'Document not found' }),
    ).toBeInTheDocument();
  });

  it('says when the document couldn’t load, and offers to try again', async () => {
    show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': fail(500, 'Down!'),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Couldn’t load the document',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('retries a canceled job, and says when it couldn’t', async () => {
    const routes = {
      'GET /api/v1/documents/d1': ok(doc({ status: 'FAILED' })),
      'GET /api/v1/documents/d1/ingestion-jobs': page([
        job({ status: 'CANCELLED', processedAt: null }),
      ]),
    };
    const { calls, user } = show(<DocumentView documentId="d1" />, MANAGER, {
      ...routes,
      'POST /api/v1/ingestion-jobs/j1/retry': ok({}),
    });

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByText('Processing Remote Work Policy.pdf again.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/j1/retry'))).toBe(true);
  });

  it('a refused retry says so', async () => {
    const { user } = show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(doc({ status: 'FAILED' })),
      'GET /api/v1/documents/d1/ingestion-jobs': page([
        job({ status: 'CANCELLED', processedAt: null }),
      ]),
      'POST /api/v1/ingestion-jobs/j1/retry': fail(409, 'Already running!'),
    });

    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Couldn’t retry it')).toBeInTheDocument();
  });

  it('stops a running job after asking, and says when it couldn’t', async () => {
    const { calls, user } = show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(doc({ status: 'PROCESSING' })),
      'GET /api/v1/documents/d1/ingestion-jobs': page([
        job({ status: 'CHUNKING', processedAt: null }),
      ]),
      'DELETE /api/v1/ingestion-jobs/j1': fail(409, 'Already finished!'),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Stop processing' }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Stop processing Remote Work Policy.pdf?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Stop processing' }),
    );
    expect(
      await screen.findByText('Couldn’t stop processing'),
    ).toBeInTheDocument();
    expect(
      calls.some(
        (call) => call.method === 'DELETE' && call.url.endsWith('/j1'),
      ),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
  });

  it('moves sharing to departments: needs one, then sets them before leaving everyone', async () => {
    const { calls, user } = show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(doc()),
      'GET /api/v1/documents/d1/ingestion-jobs': page([job()]),
      'GET /api/v1/documents/d1/chunks': page([]),
      'PUT /api/v1/documents/d1/departments': ok({}),
      'PATCH /api/v1/documents/d1': ok(doc()),
    });

    await user.click(
      await screen.findByRole('radio', { name: /Only some departments/ }),
    );
    const save = screen.getByRole('button', { name: 'Save sharing' });
    await user.click(save);
    expect(
      screen.getByText('Choose at least one department.'),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Choose departments' }),
    );
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'IT support' }),
    );
    await user.keyboard('{Escape}');
    await user.click(save);
    expect(await screen.findByText('Sharing saved.')).toBeInTheDocument();
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes.map((call) => [call.method, call.body])).toEqual([
      ['PUT', { departmentIds: ['it'] }],
      ['PATCH', { isOrganizationWide: false }],
    ]);
  });

  it('discards a sharing change, and says when saving one failed', async () => {
    const { user } = show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(
        doc({ isOrganizationWide: false, departmentIds: ['hr'] }),
      ),
      'GET /api/v1/documents/d1/ingestion-jobs': page([job()]),
      'GET /api/v1/documents/d1/chunks': page([]),
      'PATCH /api/v1/documents/d1': fail(500, 'Down!'),
    });

    const everyone = await screen.findByRole('radio', {
      name: /Everyone in Northwind Health/,
    });
    await user.click(everyone);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Remove HR' })).toBeEnabled();

    await user.click(everyone);
    await user.click(screen.getByRole('button', { name: 'Save sharing' }));
    expect(
      await screen.findByText('Couldn’t save sharing'),
    ).toBeInTheDocument();
  });

  it('a deleted document reads who could see it, naming a department it can’t', async () => {
    show(<DocumentView documentId="d1" />, MANAGER, {
      'GET /api/v1/documents/d1': ok(
        doc({
          isOrganizationWide: false,
          departmentIds: ['it', 'gone'],
          deletedAt: '2026-10-03T09:00:00Z',
          deletedById: 'maya',
        }),
      ),
      'GET /api/v1/documents/d1/ingestion-jobs': page([job()]),
      'GET /api/v1/documents/d1/chunks': page([]),
    });

    expect(
      await screen.findByText('Only IT support and Unknown department'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Everyone else won’t see it in Search or Ask.'),
    ).toBeInTheDocument();
  });
});

describe('a flag', () => {
  const flag: DocumentFlagResponseDto = {
    id: 'f1',
    documentId: 'd1',
    documentTitle: 'Security Basics.pdf',
    flagType: 'OUTDATED',
    severity: 'WARNING',
    detail: 'Mentions the 2024 password rules.',
    confidenceScore: 0.72,
    detectedAt: '2026-10-14T09:00:00Z',
    resolvedAt: null,
    resolvedById: null,
    resolution: null,
    resolutionComment: null,
    relatedDocumentId: null,
    relatedChunkId: null,
  };

  it('needs a reason to be dismissed', async () => {
    const { user, calls } = show(<FlagCard flag={flag} />, MANAGER, {
      'POST /api/v1/documents/flags/f1/dismiss': ok(flag),
    });
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Dismiss flag' }),
    );

    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveFocus();
    expect(
      within(dialog).getByText('Say why you’re dismissing it.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/dismiss'))).toBe(false);

    await user.type(reason, 'Still current for 2026.');
    await user.click(
      within(dialog).getByRole('button', { name: 'Dismiss flag' }),
    );
    await waitFor(() =>
      expect(calls.find((call) => call.url.endsWith('/dismiss'))?.body).toEqual(
        {
          comment: 'Still current for 2026.',
        },
      ),
    );
  });

  it('a resolver missing from the people says "someone", mid-sentence', async () => {
    show(
      <FlagCard
        flag={{
          ...flag,
          resolvedAt: '2026-10-15T09:00:00Z',
          resolvedById: 'gone',
          resolution: 'DISMISSED',
          resolutionComment: 'Still current.',
        }}
      />,
      MANAGER,
    );

    expect(
      await screen.findByText(
        'Dismissed by someone on 15 Oct 2026: “Still current.”',
      ),
    ).toBeInTheDocument();
  });

  it('reads its type, detail and confidence, and how it was resolved', () => {
    show(
      <FlagCard
        flag={{
          ...flag,
          resolvedAt: '2026-10-15T09:00:00Z',
          resolution: 'DOCUMENT_REPLACED',
        }}
      />,
      MANAGER,
    );

    expect(screen.getByText('Out of date')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mentions the 2024 password rules. · Confidence in this finding: 72%',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Resolved when the file was replaced, 15 Oct 2026.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dismiss' }),
    ).not.toBeInTheDocument();
  });
});
