import { expect, test, type Page, type Route } from '@playwright/test';
import { api } from '../support';
import { look } from './look';
import { sessionAs, signInAs, tenant, type Person } from './tenant';

/**
 * Knowledge management (design 07): the documents list, Upload, one document
 * and the quality flags, in every state, light and dark, at both widths.
 * People are the tenant's own (tenant.ts); the knowledge base is answered
 * here with the examples the designs draw (Northwind Health's 23 documents,
 * 5 open flags), and a state that needs a call to fail, wait or refuse is
 * made with `page.route`. A manager who may only read, or only share, is a
 * real person with a real role: the viewer is read on the server.
 */

/** The gateway's envelope around `data`, or its error. */
const ok = (data: unknown) => ({
  json: { success: true, statusCode: 200, message: 'OK', data },
});
const failed = (status: number, error = 'Failed!') => ({
  status,
  json: {
    success: false,
    statusCode: status,
    path: '/api/v1',
    timestamp: '2026-10-17T00:00:00.000Z',
    error,
  },
});
const paged = (items: unknown[], total = items.length, perPage = 8) =>
  ok({
    items,
    meta: {
      currentPage: 1,
      itemsPerPage: perPage,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      itemCount: items.length,
    },
  });
/** A call that never answers: the state while it's on its way. */
const hang = () => undefined;

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const DEPARTMENTS = [
  { id: 'hr', name: 'HR' },
  { id: 'it', name: 'IT support' },
  { id: 'billing', name: 'Billing' },
  { id: 'finance', name: 'Finance' },
];

type Doc = Record<string, unknown> & { id: string; title: string };
let owner = '';
const doc = (id: string, title: string, over: object = {}): Doc => ({
  id,
  organizationId: 'o1',
  createdById: owner,
  title,
  fileUrl: `organizations/o1/documents/${id}/x`,
  fileType: title.split('.').pop() ?? 'pdf',
  ocrLanguages: ['en'],
  fileSizeBytes: 2_516_582,
  isOrganizationWide: true,
  status: 'INDEXED',
  departmentIds: [],
  chunkCount: 48,
  createdAt: '2026-09-12T09:28:00Z',
  updatedAt: '2026-10-02T14:08:00Z',
  deletedAt: null,
  deletedById: null,
  ...over,
});

/** The eight the first page draws. */
const documents = (): Doc[] => [
  doc('d1', 'Remote Work Policy.pdf'),
  doc('d2', 'Expenses FAQ.md', {
    fileType: 'md',
    fileSizeBytes: 18_432,
    updatedAt: '2026-09-28T09:00:00Z',
  }),
  doc('d3', 'Parental Leave Policy.docx', {
    fileType: 'docx',
    fileSizeBytes: 348_160,
    status: 'PROCESSING',
    isOrganizationWide: false,
    departmentIds: ['hr'],
    chunkCount: 0,
    updatedAt: ago(90),
  }),
  doc('d4', 'IT Equipment Returns.txt', {
    fileType: 'txt',
    fileSizeBytes: 9_216,
    status: 'PENDING',
    isOrganizationWide: false,
    departmentIds: ['it'],
    chunkCount: 0,
    updatedAt: ago(0.2),
  }),
  doc('d5', 'Travel and Expenses Policy.pdf', {
    fileSizeBytes: 3_355_443,
    status: 'FAILED',
    isOrganizationWide: false,
    departmentIds: ['billing', 'finance'],
    chunkCount: 0,
    updatedAt: ago(120),
  }),
  doc('d6', 'New Starter Guide.pdf', {
    fileSizeBytes: 6_396_313,
    isOrganizationWide: false,
    departmentIds: ['hr'],
    updatedAt: '2026-09-15T09:00:00Z',
  }),
  doc('d7', 'Benefits Portal Help.md', {
    fileType: 'md',
    fileSizeBytes: 22_528,
    updatedAt: '2026-08-21T09:00:00Z',
  }),
  doc('d8', 'Security Basics.pdf', {
    fileSizeBytes: 1_153_434,
    isOrganizationWide: false,
    departmentIds: ['it'],
    updatedAt: '2026-08-01T09:00:00Z',
  }),
];

const job = (over: object = {}) => ({
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
const HISTORY = [
  job({
    id: 'j0',
    status: 'FAILED',
    errorCode: 'OTHER',
    failedStage: 'PARSING',
    errorLog: 'The connection was reset.',
    createdAt: '2026-09-12T09:11:00Z',
    processedAt: '2026-09-12T09:12:00Z',
  }),
  job({
    id: 'j9',
    createdAt: '2026-09-12T09:28:00Z',
    processedAt: '2026-09-12T09:30:00Z',
  }),
  job(),
];

const flag = (
  id: string,
  documentId: string,
  documentTitle: string,
  over: object,
) => ({
  id,
  documentId,
  documentTitle,
  flagType: 'OUTDATED',
  severity: 'WARNING',
  detail: '',
  confidenceScore: null,
  detectedAt: ago(3 * 24 * 60),
  resolvedAt: null,
  resolvedById: null,
  resolution: null,
  resolutionComment: null,
  relatedDocumentId: null,
  relatedChunkId: null,
  ...over,
});
const FLAGS = [
  flag('f1', 'd2', 'Expenses FAQ.md', {
    flagType: 'CONFLICTING',
    severity: 'CRITICAL',
    detail:
      'Says claims are due within 30 days; Travel and Expenses Policy.pdf says 60.',
    confidenceScore: 0.86,
    detectedAt: ago(24 * 60),
    relatedDocumentId: 'd5',
  }),
  flag('f2', 'd8', 'Security Basics.pdf', {
    detail:
      'Mentions the 2024 password rules; newer documents describe the 2026 ones.',
    confidenceScore: 0.72,
  }),
  flag('f3', 'd1', 'Remote Work Policy.pdf', {
    flagType: 'LOW_CONFIDENCE',
    detail: 'Answers citing it averaged 41% confidence.',
    confidenceScore: 0.8,
  }),
  flag('f4', 'd6', 'New Starter Guide.pdf', {
    flagType: 'PAGES_NOT_INDEXED',
    detail: 'Pages 12–14 couldn’t be read, so they aren’t searchable.',
    detectedAt: ago(5 * 24 * 60),
  }),
  flag('f5', 'd2', 'Expenses FAQ.md', {
    flagType: 'UNCITED',
    severity: 'INFO',
    detail: 'Retrieved 42 times in 30 days; cited 0 times.',
    confidenceScore: 0.65,
    detectedAt: ago(6 * 24 * 60),
  }),
];

const PASSAGES = [
  'Northwind Health supports remote work for roles that don’t need to be on site. This policy explains who can work remotely, how to ask, and what we expect…',
  'Eligibility. Employees who have completed their probation period may ask to work remotely up to three days a week, with their manager’s agreement…',
  'Equipment. The company provides a laptop and headset. Monitors and chairs can be claimed through the Expenses FAQ up to the yearly allowance…',
  'Security. Use the VPN on any network you don’t control, and lock your screen whenever you step away. See Security Basics for the full rules…',
].map((contentText, index) => ({
  id: `c${index + 1}`,
  documentId: 'd1',
  chunkIndex: index,
  contentText,
  pageNumber: [1, 1, 2, 3][index],
  tokenCount: [212, 188, 240, 201][index],
  vectorPointId: `v${index}`,
  createdAt: '2026-10-02T14:08:00Z',
}));

type Knowledge = {
  list?: object | typeof hang;
  storage?: object;
  flags?: object | typeof hang;
  document?: object | typeof hang;
  jobs?: object;
};

/**
 * The knowledge base the designs draw. Every document call is answered
 * here; anything unanswered goes to the gateway.
 */
async function knowledge(page: Page, options: Knowledge = {}): Promise<void> {
  const reply = (body: object | typeof hang) => (route: Route) =>
    typeof body === 'function' ? undefined : route.fulfill(body);
  await page.route('**/api/v1/departments?*', (route) =>
    route.fulfill(paged(DEPARTMENTS, 4, 100)),
  );
  await page.route('**/api/v1/documents/storage', (route) =>
    route.fulfill(
      options.storage ??
        ok({
          usedBytes: Math.round(3.9 * 1024 ** 3),
          limitBytes: 5 * 1024 ** 3,
          documentCount: 23,
        }),
    ),
  );
  await page.route('**/api/v1/documents/flags?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('limit') === '1') return route.fulfill(paged([], 5));
    const documentId = query.get('documentId');
    const mine = FLAGS.filter(
      (each) => !documentId || each.documentId === documentId,
    );
    return reply(options.flags ?? paged(mine, mine.length, 10))(route);
  });
  await page.route(
    '**/api/v1/documents?*',
    reply(options.list ?? paged(documents(), 23)),
  );
  await page.route('**/api/v1/documents/d*/ingestion-jobs', (route) => {
    const id = /documents\/(d\d+)\//.exec(route.request().url())?.[1];
    if (options.jobs) return route.fulfill(options.jobs);
    return route.fulfill(
      paged(
        id === 'd3'
          ? [
              job({
                id: 'j3',
                documentId: 'd3',
                status: 'EMBEDDING',
                processedAt: null,
                createdAt: ago(90),
              }),
            ]
          : id === 'd4'
            ? [
                job({
                  id: 'j4',
                  documentId: 'd4',
                  status: 'QUEUED',
                  processedAt: null,
                  createdAt: ago(1),
                }),
              ]
            : id === 'd5'
              ? [
                  job({
                    id: 'j5',
                    documentId: 'd5',
                    status: 'FAILED',
                    errorCode: 'NO_READABLE_TEXT',
                    failedStage: 'PARSING',
                    processedAt: ago(118),
                    createdAt: ago(120),
                  }),
                ]
              : HISTORY,
      ),
    );
  });
  await page.route('**/api/v1/documents/d1/chunks?*', (route) =>
    route.fulfill(paged(PASSAGES, 48, 4)),
  );
  await page.route(
    '**/api/v1/documents/d1',
    reply(options.document ?? ok(documents()[0])),
  );
}

/** A person in their own tenant holding exactly these codes, made once. */
const people = new Map<string, Promise<Person>>();
function personWith(name: string, codes: string[]): Promise<Person> {
  let person = people.get(name);
  if (!person) {
    person = makePerson(name, codes);
    people.set(name, person);
  }
  return person;
}

async function makePerson(name: string, codes: string[]): Promise<Person> {
  const { maya, jordan } = await tenant(name);
  const session = await sessionAs(maya);
  const { id } = await api<{ id: string }>(session, 'POST', '/roles', {
    name: `Knowledge ${name}`,
    permissionCodes: codes,
  });
  await api(session, 'PUT', `/users/${jordan.id}/roles`, { roleIds: [id] });
  await session.dispose();
  return jordan;
}

const MENU = { disabled: ['aria-hidden-focus'] };

test.beforeEach(async () => {
  owner = (await tenant('km')).maya.id;
});

test.describe('documents', () => {
  const open = async (page: Page, options: Knowledge = {}) => {
    const { maya } = await tenant('km');
    await signInAs(page, maya);
    await knowledge(page, options);
    await page.goto('/knowledge/documents');
    await expect(
      page.getByRole('heading', { name: 'Knowledge', level: 1 }),
    ).toBeVisible();
  };

  test('a full manager', async ({ page }) => {
    await open(page);
    await expect(
      page.getByRole('link', { name: 'Security Basics.pdf' }).first(),
    ).toBeVisible();
    await expect(page.getByText('Embedding…').first()).toBeVisible();
    await look(page, 'documents');
  });

  test('row actions', async ({ page }) => {
    await open(page);
    await page
      .getByRole('button', { name: 'Actions for Remote Work Policy.pdf' })
      .first()
      .click();
    await expect(page.getByRole('menuitem', { name: 'Reindex' })).toBeVisible();
    await look(page, 'documents-row-actions', { viewportOnly: true, ...MENU });
  });

  test('a manager who may only read', async ({ page }) => {
    const reader = await personWith('km-read', ['document.read']);
    await signInAs(page, reader);
    await knowledge(page);
    await page.goto('/knowledge/documents');
    await expect(
      page.getByRole('link', { name: 'Security Basics.pdf' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
    await look(page, 'documents-read-only');
  });

  test('storage almost full', async ({ page }) => {
    await open(page, {
      storage: ok({
        usedBytes: Math.round(4.6 * 1024 ** 3),
        limitBytes: 5 * 1024 ** 3,
        documentCount: 23,
      }),
    });
    await expect(page.getByText('Storage is almost full')).toBeVisible();
    await look(page, 'documents-storage-almost');
  });

  test('storage full', async ({ page }) => {
    await open(page, {
      storage: ok({
        usedBytes: 5 * 1024 ** 3,
        limitBytes: 5 * 1024 ** 3,
        documentCount: 23,
      }),
    });
    await expect(
      page.getByRole('button', { name: 'Upload', exact: true }),
    ).toBeDisabled();
    await look(page, 'documents-storage-full');
  });

  test('empty', async ({ page }) => {
    await open(page, {
      list: paged([]),
      storage: ok({
        usedBytes: 0,
        limitBytes: 5 * 1024 ** 3,
        documentCount: 0,
      }),
    });
    await expect(page.getByText('No documents yet')).toBeVisible();
    await look(page, 'documents-empty');
  });

  test('no results', async ({ page }) => {
    await open(page);
    await page.unroute('**/api/v1/documents?*');
    await page.route('**/api/v1/documents?*', (route) =>
      route.fulfill(paged([])),
    );
    await page
      .getByRole('searchbox', { name: 'Search documents' })
      .fill('holiday rota');
    await expect(page.getByText('No documents match')).toBeVisible();
    await look(page, 'documents-no-results');
  });

  test('loading', async ({ page }) => {
    await open(page, { list: hang });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading documents' }),
    ).toBeAttached();
    await look(page, 'documents-loading');
  });

  test('error', async ({ page }) => {
    await open(page, { list: failed(500) });
    await expect(page.getByText('Couldn’t load the documents')).toBeVisible();
    await look(page, 'documents-error');
  });

  test('show deleted', async ({ page }) => {
    await open(page, {
      list: paged(
        [
          doc('d9', 'Holiday Calendar 2025.pdf', {
            fileSizeBytes: 215_040,
            deletedAt: '2026-10-03T09:00:00Z',
            updatedAt: '2026-10-03T09:00:00Z',
          }),
          ...documents().slice(0, 7),
        ],
        24,
      ),
    });
    await page.getByRole('switch', { name: 'Show deleted' }).click();
    await expect(page.getByText('Deleted').first()).toBeVisible();
    await look(page, 'documents-show-deleted');
  });

  test('updating and waiting', async ({ page }) => {
    const list = documents();
    list[0] = { ...list[0], status: 'PROCESSING', updatedAt: ago(5) };
    await open(page, { list: paged(list, 23) });
    await page.unroute('**/api/v1/documents/d*/ingestion-jobs');
    await page.route('**/api/v1/documents/d*/ingestion-jobs', (route) => {
      const id = /documents\/(d\d+)\//.exec(route.request().url())?.[1];
      return route.fulfill(
        paged(
          id === 'd1'
            ? [
                ...HISTORY,
                job({
                  id: 'j10',
                  status: 'PARSING',
                  processedAt: null,
                  createdAt: ago(5),
                }),
              ]
            : id === 'd4'
              ? [
                  job({
                    id: 'j4',
                    documentId: 'd4',
                    status: 'QUEUED',
                    waitingReason: 'AI_ALLOWANCE',
                    processedAt: null,
                  }),
                ]
              : [
                  job({
                    id: 'j3',
                    documentId: id,
                    status: 'EMBEDDING',
                    processedAt: null,
                  }),
                ],
        ),
      );
    });
    await expect(
      page
        .getByText(
          'Updating — answers use the current version until the new one is ready',
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText('Waiting for the AI allowance to reset').first(),
    ).toBeVisible();
    await look(page, 'documents-updating-waiting');
  });
});

test.describe('upload', () => {
  const FILES = [
    {
      name: 'Remote Work Policy 2027.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(2_726_297, 32),
    },
    {
      name: 'Onboarding checklist.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.alloc(90_112, 32),
    },
    {
      name: 'Office Wi-Fi and printers.md',
      mimeType: 'text/markdown',
      buffer: Buffer.alloc(3_072, 32),
    },
  ];
  const open = async (page: Page, options: Knowledge = {}) => {
    const { maya } = await tenant('km');
    await signInAs(page, maya);
    await knowledge(page, options);
    await page.goto('/knowledge/documents');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    return page.getByRole('dialog', { name: 'Upload documents' });
  };
  const add = (page: Page, files: typeof FILES) =>
    page.getByRole('dialog').locator('input[type="file"]').setInputFiles(files);
  /** Presign answers as given; the bytes and confirm succeed. */
  const presign = async (
    page: Page,
    answer: (index: number) => object | typeof hang,
  ) => {
    let count = 0;
    await page.route('**/api/v1/documents/presign', (route) => {
      const body = answer(count++);
      return typeof body === 'function' ? undefined : route.fulfill(body);
    });
  };
  const signed = ok({
    uploadUrl: 'http://localhost:9199/upload/fake',
    uploadMethod: 'POST',
    objectPath: 'organizations/o1/documents/n/x.pdf',
    expiresAt: '2026-10-17T10:00:00Z',
  });

  test('open, no files yet', async ({ page }) => {
    const dialog = await open(page);
    await expect(
      dialog.getByRole('button', { name: 'Choose files' }),
    ).toBeVisible();
    await look(page, 'upload-open', { viewportOnly: true });
  });

  test('files added, one refused before upload', async ({ page }) => {
    const dialog = await open(page);
    await add(page, [
      ...FILES,
      {
        name: 'Q3 all-hands.pptx',
        mimeType: 'application/vnd.ms-powerpoint',
        buffer: Buffer.from('x'),
      },
    ]);
    await expect(
      dialog.getByText(
        'PowerPoint files can’t be uploaded. Use PDF, Word, Markdown or text.',
      ),
    ).toBeVisible();
    await look(page, 'upload-files-added', { viewportOnly: true });
  });

  test('departments chosen, OCR languages open', async ({ page }) => {
    const dialog = await open(page);
    await add(page, FILES);
    await dialog.getByRole('radio', { name: 'Only some departments' }).check();
    await dialog.getByRole('button', { name: 'Choose departments' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'HR' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Finance' }).click();
    await page.keyboard.press('Escape');
    await expect(
      dialog.getByText(
        'Only people in HR and Finance get answers from these documents.',
      ),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Choose ocr languages' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Spanish' }).click();
    await look(page, 'upload-departments-ocr', { viewportOnly: true, ...MENU });
  });

  test('uploading: progress per file, one failed with Retry', async ({
    page,
  }) => {
    const dialog = await open(page);
    await add(page, FILES);
    await presign(page, () => signed);
    let sent = 0;
    await page.route('**/upload/fake*', (route) =>
      sent++ === 0
        ? route.fulfill({ status: 200 })
        : sent === 2
          ? undefined
          : route.abort(),
    );
    await page.route('**/api/v1/documents/confirm', (route) =>
      route.fulfill(ok(doc('n1', 'x'))),
    );
    await dialog.getByRole('button', { name: 'Upload 3 documents' }).click();
    await expect(
      dialog.getByText('Uploaded. Processing comes next.'),
    ).toBeVisible();
    await expect(dialog.getByText(/^Uploading… \d+%$/)).toBeVisible();
    await look(page, 'upload-uploading', { viewportOnly: true });
  });

  test('all done', async ({ page }) => {
    const dialog = await open(page);
    await add(page, FILES);
    await presign(page, () => signed);
    await page.route('**/upload/fake*', (route) =>
      route.fulfill({ status: 200 }),
    );
    await page.route('**/api/v1/documents/confirm', (route) =>
      route.fulfill(ok(doc('n1', 'x'))),
    );
    await dialog.getByRole('button', { name: 'Upload 3 documents' }).click();
    await expect(dialog.getByText('3 documents uploaded')).toBeVisible();
    await look(page, 'upload-done', { viewportOnly: true });
  });

  for (const [name, sentence, title] of [
    [
      'storage',
      'Your document storage is full. New uploads will be refused until space is freed or your plan is changed!',
      'Storage is full',
    ],
    [
      'count',
      'You have reached the document limit on your plan. New uploads will be refused until documents are removed or your plan is changed!',
      'The document limit is reached',
    ],
  ] as const) {
    test(`402: ${title.toLowerCase()}`, async ({ page }) => {
      const dialog = await open(page);
      await add(page, FILES);
      await presign(page, (index) =>
        index < 2 ? signed : failed(402, sentence),
      );
      await page.route('**/upload/fake*', (route) =>
        route.fulfill({ status: 200 }),
      );
      await page.route('**/api/v1/documents/confirm', (route) =>
        route.fulfill(ok(doc('n1', 'x'))),
      );
      await dialog.getByRole('button', { name: 'Upload 3 documents' }).click();
      await expect(dialog.getByText(title, { exact: true })).toBeVisible();
      await look(page, `upload-402-${name}`, { viewportOnly: true });
    });
  }

  test('429: too many uploads at once', async ({ page }) => {
    const dialog = await open(page);
    await add(page, FILES);
    await presign(page, (index) =>
      index === 0 ? signed : failed(429, 'Too many requests!'),
    );
    await page.route('**/upload/fake*', (route) =>
      route.fulfill({ status: 200 }),
    );
    await page.route('**/api/v1/documents/confirm', (route) =>
      route.fulfill(ok(doc('n1', 'x'))),
    );
    await dialog.getByRole('button', { name: 'Upload 3 documents' }).click();
    await expect(dialog.getByText('Too many uploads at once')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Retry 2 files' }),
    ).toBeVisible();
    await look(page, 'upload-429', { viewportOnly: true });
  });

  test('dragging files over the drop zone', async ({ page }) => {
    const dialog = await open(page);
    const zone = dialog.getByText('Drag files here, or').locator('..');
    const dataTransfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
      return data;
    });
    await expect(async () => {
      await zone.dispatchEvent('dragover', { dataTransfer });
      await expect(dialog.getByText('Drop to add them')).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 15_000 });
    await look(page, 'upload-dragging', { viewportOnly: true });
  });
});

test.describe('one document', () => {
  const open = async (page: Page, options: Knowledge = {}, as?: Person) => {
    const { maya } = await tenant('km');
    await signInAs(page, as ?? maya);
    await knowledge(page, options);
    await page.goto('/knowledge/documents/d1');
  };

  test('indexed', async ({ page }) => {
    await open(page);
    await expect(page.getByText(/^Indexed on 2 Oct 2026 at/)).toBeVisible();
    await expect(
      page.getByText('Passage 1 · Page 1 · 212 tokens'),
    ).toBeVisible();
    await look(page, 'document');
  });

  test('processing at Chunking', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Parental Leave Policy.docx', {
          status: 'PROCESSING',
          chunkCount: 0,
          isOrganizationWide: false,
          departmentIds: ['hr'],
        }),
      ),
      jobs: paged([
        job({ status: 'CHUNKING', processedAt: null, createdAt: ago(3) }),
      ]),
    });
    await expect(
      page.getByRole('button', { name: 'Stop processing' }),
    ).toBeVisible();
    await look(page, 'document-processing');
  });

  test('updating', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Remote Work Policy.pdf', { status: 'PROCESSING' }),
      ),
      jobs: paged([
        ...HISTORY,
        job({
          id: 'j10',
          status: 'PARSING',
          processedAt: null,
          createdAt: ago(2),
        }),
      ]),
    });
    await expect(
      page.getByText(
        'Near the end, while the new passages are prepared, it briefly answers nothing.',
      ),
    ).toBeVisible();
    await look(page, 'document-updating');
  });

  for (const [name, code, stage, words] of [
    [
      'no-text',
      'NO_READABLE_TEXT',
      'PARSING',
      'We couldn’t find readable text, even with OCR.',
    ],
    [
      'provider',
      'PROVIDER_FAILURE',
      'EMBEDDING',
      'The AI service didn’t respond while preparing the passages.',
    ],
  ] as const) {
    test(`failed: ${name}`, async ({ page }) => {
      await open(page, {
        document: ok(
          doc('d1', 'Travel and Expenses Policy.pdf', {
            status: 'FAILED',
            chunkCount: 0,
            isOrganizationWide: false,
            departmentIds: ['billing', 'finance'],
          }),
        ),
        jobs: paged([
          job({
            status: 'FAILED',
            errorCode: code,
            failedStage: stage,
            errorLog:
              'OCR found no readable text in this document. If it is not in English, re-upload it specifying its language.',
            processedAt: ago(1),
            createdAt: ago(3),
          }),
        ]),
      });
      await expect(page.getByText(words)).toBeVisible();
      await page.getByRole('button', { name: 'Technical details' }).click();
      await look(page, `document-failed-${name}`);
    });
  }

  test('canceled', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Travel and Expenses Policy.pdf', {
          status: 'FAILED',
          chunkCount: 0,
        }),
      ),
      jobs: paged([
        job({
          status: 'CANCELLED',
          errorLog: 'Cancelled',
          processedAt: ago(1),
          createdAt: ago(2),
        }),
      ]),
    });
    await expect(page.getByText('Processing was canceled')).toBeVisible();
    await look(page, 'document-canceled');
  });

  test('queued', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'IT Equipment Returns.txt', {
          status: 'PENDING',
          chunkCount: 0,
        }),
      ),
      jobs: paged([
        job({ status: 'QUEUED', processedAt: null, createdAt: ago(1) }),
      ]),
    });
    await expect(
      page.getByText(
        'Waiting to start. Answers won’t use it until processing finishes.',
      ),
    ).toBeVisible();
    await look(page, 'document-queued');
  });

  test('queued for the AI allowance', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'IT Equipment Returns.txt', {
          status: 'PENDING',
          chunkCount: 0,
        }),
      ),
      jobs: paged([
        job({
          status: 'QUEUED',
          waitingReason: 'AI_ALLOWANCE',
          processedAt: null,
          createdAt: ago(60),
        }),
      ]),
    });
    await expect(
      page.getByRole('link', { name: 'See plans and billing' }),
    ).toBeVisible();
    await look(page, 'document-allowance');
  });

  test('sharing: a department added', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Parental Leave Policy.docx', {
          isOrganizationWide: false,
          departmentIds: ['hr'],
        }),
      ),
    });
    const sharing = page.getByRole('region', { name: 'Who can see it' });
    await sharing.getByRole('button', { name: 'Choose departments' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'IT support' }).click();
    await page.keyboard.press('Escape');
    await expect(
      sharing.getByRole('button', { name: 'Save sharing' }),
    ).toBeEnabled();
    await look(page, 'document-sharing');
  });

  test('sharing: a manager who can share but not edit', async ({ page }) => {
    const sharer = await personWith('km-share', [
      'document.read',
      'document.share',
      'department.read',
    ]);
    await open(
      page,
      {
        document: ok(
          doc('d1', 'Security Basics.pdf', {
            isOrganizationWide: false,
            departmentIds: ['it', 'hr'],
          }),
        ),
      },
      sharer,
    );
    await expect(
      page.getByText(
        'Only people who can edit documents can switch between everyone and departments.',
      ),
    ).toBeVisible();
    await look(page, 'document-share-only');
  });

  test('a manager who may only read', async ({ page }) => {
    const reader = await personWith('km-read', ['document.read']);
    await open(page, {}, reader);
    await expect(
      page.getByRole('button', { name: /Download original/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reindex' })).toHaveCount(0);
    await look(page, 'document-read-only');
  });

  test('deleted', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Holiday Calendar 2025.pdf', {
          fileSizeBytes: 215_040,
          deletedAt: '2026-10-03T09:00:00Z',
          updatedAt: '2026-10-03T09:00:00Z',
        }),
      ),
    });
    await expect(
      page.getByText('This document was deleted on 3 Oct 2026'),
    ).toBeVisible();
    await look(page, 'document-deleted');
  });

  test('more actions', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await look(page, 'document-more-actions', { viewportOnly: true, ...MENU });
  });

  test('replace: a new file chosen', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Replace file' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Replace the file' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Remote Work Policy 2027.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(2_726_297, 32),
    });
    await expect(dialog.getByText('What happens next')).toBeVisible();
    await look(page, 'document-replace', { viewportOnly: true });
  });

  test('replace: refused while a job runs', async ({ page }) => {
    await open(page);
    await page.route('**/api/v1/documents/presign', (route) =>
      route.fulfill(
        ok({
          uploadUrl: 'http://localhost:9199/upload/fake',
          uploadMethod: 'POST',
          objectPath: 'x',
          expiresAt: '2026-10-17T10:00:00Z',
        }),
      ),
    );
    await page.route('**/upload/fake*', (route) =>
      route.fulfill({ status: 200 }),
    );
    await page.route('**/api/v1/documents/d1/replace', (route) =>
      route.fulfill(failed(409, 'A job is running!')),
    );
    await page.getByRole('button', { name: 'Replace file' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Replace the file' });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Remote Work Policy 2027.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(2_048, 32),
    });
    await dialog.getByRole('button', { name: 'Replace file' }).click();
    await expect(
      dialog.getByText(
        'This document is being processed. Try again when it’s done.',
      ),
    ).toBeVisible();
    await look(page, 'document-replace-409', { viewportOnly: true });
  });

  test('edit the title', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Edit document' }),
    ).toBeVisible();
    await look(page, 'document-edit', { viewportOnly: true });
  });

  test('delete: the confirmation', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await look(page, 'document-delete', { viewportOnly: true });
  });

  test('stop processing: the confirmation', async ({ page }) => {
    await open(page, {
      document: ok(
        doc('d1', 'Parental Leave Policy.docx', {
          status: 'PROCESSING',
          chunkCount: 0,
        }),
      ),
      jobs: paged([
        job({ status: 'CHUNKING', processedAt: null, createdAt: ago(3) }),
      ]),
    });
    await page.getByRole('button', { name: 'Stop processing' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await look(page, 'document-stop', { viewportOnly: true });
  });

  test('loading', async ({ page }) => {
    await open(page, { document: hang });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the document' }),
    ).toBeAttached();
    await look(page, 'document-loading');
  });

  test('not found', async ({ page }) => {
    await open(page, { document: failed(404, 'No document!') });
    await expect(
      page.getByRole('heading', { name: 'Document not found' }),
    ).toBeVisible();
    await look(page, 'document-not-found');
  });
});

test.describe('quality flags', () => {
  const open = async (page: Page, options: Knowledge = {}, as?: Person) => {
    const { maya } = await tenant('km');
    await signInAs(page, as ?? maya);
    await knowledge(page, options);
    await page.goto('/knowledge/flags');
  };
  const card = (page: Page, name: string) =>
    page.getByRole('article', { name });

  test('open flags', async ({ page }) => {
    await open(page);
    await expect(page.getByText('5 open')).toBeVisible();
    await look(page, 'flags');
  });

  test('show resolved', async ({ page }) => {
    await open(page);
    await page.unroute('**/api/v1/documents/flags?*');
    await page.route('**/api/v1/documents/flags?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get('limit') === '1') return route.fulfill(paged([], 5));
      return route.fulfill(
        paged(
          [
            ...FLAGS.slice(0, 2),
            flag('r1', 'd3', 'Parental Leave Policy.docx', {
              flagType: 'UNRETRIEVED',
              severity: 'INFO',
              detail: 'Not retrieved in 60 days.',
              resolvedAt: '2026-10-10T09:00:00Z',
              resolvedById: owner,
              resolution: 'FIXED',
              resolutionComment: 'Retitled so it matches how people ask.',
            }),
            flag('r2', 'd1', 'Remote Work Policy.pdf', {
              resolvedAt: '2026-10-08T09:00:00Z',
              resolution: 'DOCUMENT_REPLACED',
            }),
          ],
          7,
          10,
        ),
      );
    });
    await page.getByRole('switch', { name: 'Show resolved' }).click();
    await expect(
      page.getByText('Resolved when the file was replaced, 8 Oct 2026.'),
    ).toBeVisible();
    await look(page, 'flags-resolved');
  });

  test('a manager who may only read', async ({ page }) => {
    const reader = await personWith('km-read', ['document.read']);
    await open(page, {}, reader);
    await expect(page.getByText('5 open')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
    await look(page, 'flags-read-only');
  });

  test('dismiss: a reason is required', async ({ page }) => {
    await open(page);
    await card(page, 'Out of date, Security Basics.pdf')
      .getByRole('button', { name: 'Dismiss' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss this flag?' });
    await dialog.getByRole('button', { name: 'Dismiss flag' }).click();
    await expect(
      dialog.getByText('Say why you’re dismissing it.'),
    ).toBeVisible();
    await look(page, 'flags-dismiss', { viewportOnly: true });
  });

  test('fixed: an optional comment', async ({ page }) => {
    await open(page);
    await card(page, 'Out of date, Security Basics.pdf')
      .getByRole('button', { name: 'Fixed' })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Mark as fixed?' }),
    ).toBeVisible();
    await look(page, 'flags-fixed', { viewportOnly: true });
  });

  test('replaced', async ({ page }) => {
    await open(page);
    await card(page, 'Out of date, Security Basics.pdf')
      .getByRole('button', { name: 'Replaced' })
      .click();
    await expect(
      page.getByText('Haven’t replaced the file yet?'),
    ).toBeVisible();
    await look(page, 'flags-replaced', { viewportOnly: true });
  });

  test('the flag menu', async ({ page }) => {
    await open(page);
    await card(page, 'Out of date, Security Basics.pdf')
      .getByRole('button', { name: 'More actions' })
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Delete flag' }),
    ).toBeVisible();
    await look(page, 'flags-menu', { viewportOnly: true, ...MENU });
  });

  test('delete flag: the confirmation', async ({ page }) => {
    await open(page);
    await card(page, 'Out of date, Security Basics.pdf')
      .getByRole('button', { name: 'More actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete flag' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await look(page, 'flags-delete', { viewportOnly: true });
  });

  test('nothing needs attention', async ({ page }) => {
    await open(page, { flags: paged([]) });
    await expect(page.getByText('Nothing needs attention')).toBeVisible();
    await look(page, 'flags-none');
  });

  test('loading', async ({ page }) => {
    await open(page, { flags: hang });
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading flags' }),
    ).toBeAttached();
    await look(page, 'flags-loading');
  });

  test('error', async ({ page }) => {
    await open(page, { flags: failed(500) });
    await expect(page.getByText('Couldn’t load the flags')).toBeVisible();
    await look(page, 'flags-error');
  });
});
