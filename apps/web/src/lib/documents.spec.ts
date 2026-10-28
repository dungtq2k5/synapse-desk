import type { IngestionJobResponseDto } from '@synapsedesk/api-client';
import {
  asSentence,
  checkFile,
  failure,
  isUpdating,
  isWorking,
  ocrLanguageAllowed,
  stageCaption,
  storageLevel,
  updateFailed,
  updatedLabel,
} from './documents';

const job = (
  over: Partial<IngestionJobResponseDto>,
): IngestionJobResponseDto => ({
  id: 'j',
  documentId: 'd',
  bullmqJobId: '',
  status: 'QUEUED',
  errorLog: null,
  errorCode: null,
  failedStage: null,
  waitingReason: null,
  processedAt: null,
  createdAt: '2026-10-17T00:00:00Z',
  ...over,
});

describe('document wording', () => {
  it('checks a file before it is sent: its type by name, then its size', () => {
    expect(checkFile(new File(['x'], 'Notes.MD'))).toEqual({
      contentType: 'text/markdown',
    });
    expect(checkFile(new File(['x'], 'Q3 all-hands.pptx'))).toEqual({
      refusal:
        'PowerPoint files can’t be uploaded. Use PDF, Word, Markdown or text.',
    });
    const big = new File(['x'], 'scan.pdf');
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    expect(checkFile(big)).toEqual({ refusal: 'Larger than 100 MB.' });
  });

  it('says what a failure code means, and which actions can help', () => {
    expect(failure('TOO_LONG', 'pdf')).toMatchObject({
      retry: false,
      replace: true,
    });
    expect(failure('NO_READABLE_TEXT', 'pdf').sentence).toMatch(
      /even with OCR/,
    );
    expect(failure('NO_READABLE_TEXT', 'md').sentence).toMatch(/isn’t empty/);
    expect(failure('OCR_UNAVAILABLE', 'pdf')).toMatchObject({
      retry: false,
      replace: false,
    });
    expect(failure('PROVIDER_FAILURE', 'pdf')).toMatchObject({
      retry: true,
      replace: true,
    });
    expect(failure(null, 'pdf').sentence).toMatch(/couldn’t be processed/);
  });

  it('captions a running job by its stage, or why it waits', () => {
    expect(stageCaption(job({ status: 'CHUNKING' }))).toBe('Chunking…');
    expect(stageCaption(job({ status: 'QUEUED' }))).toBe('Queued…');
    expect(
      stageCaption(job({ status: 'QUEUED', waitingReason: 'AI_ALLOWANCE' })),
    ).toBe('Waiting for the AI allowance to reset');
  });

  it('reads working, updating and a failed update off the newest job', () => {
    const latest = (status: IngestionJobResponseDto['status']) => ({
      status,
      waitingReason: null,
      errorCode: null,
    });

    expect(isWorking({ status: 'PENDING', latestJob: null })).toBe(false);
    expect(isWorking({ status: 'INDEXED', latestJob: latest('QUEUED') })).toBe(
      true,
    );
    expect(
      isWorking({ status: 'INDEXED', latestJob: latest('COMPLETED') }),
    ).toBe(false);
    // A first ingestion works without updating; a replace updates.
    expect(
      isUpdating({ status: 'PROCESSING', latestJob: latest('PARSING') }),
    ).toBe(false);
    expect(
      isUpdating({ status: 'INDEXED', latestJob: latest('PARSING') }),
    ).toBe(true);
    expect(
      updateFailed({ status: 'INDEXED', latestJob: latest('FAILED') }),
    ).toBe(true);
    expect(
      updateFailed({ status: 'FAILED', latestJob: latest('FAILED') }),
    ).toBe(false);
  });

  it('levels the storage bar: under 90%, from 90%, full', () => {
    expect(storageLevel(89, 100)).toBe('ok');
    expect(storageLevel(90, 100)).toBe('almost');
    expect(storageLevel(100, 100)).toBe('full');
  });

  it('takes the server’s words back to a sentence', () => {
    expect(asSentence('Your document storage is full!')).toBe(
      'Your document storage is full.',
    );
  });

  it('allows one of Japanese and Chinese, not both', () => {
    expect(ocrLanguageAllowed('zh', ['en', 'ja'])).toBe(false);
    expect(ocrLanguageAllowed('fr', ['en', 'ja'])).toBe(true);
  });

  it('dates the Updated column', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(updatedLabel('2026-10-17T11:59:30Z', now, 'UTC')).toBe('Just now');
    expect(updatedLabel('2026-10-17T08:00:00Z', now, 'UTC')).toBe('Today');
    expect(updatedLabel('2026-10-02T08:00:00Z', now, 'UTC')).toBe('2 Oct 2026');
  });
});
