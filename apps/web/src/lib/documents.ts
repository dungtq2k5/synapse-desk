import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  NON_LATIN_OCR_LANGUAGES,
  type AllowedDocumentMimeType,
  type OcrLanguage,
} from '@synapsedesk/contracts';
import type {
  DocumentFlagResponseDtoFlagType,
  DocumentResponseDto,
  DocumentResponseDtoFileType,
  DocumentResponseDtoStatus,
  IngestionJobResponseDto,
} from '@synapsedesk/api-client';

export type DocumentStatus = NonNullable<DocumentResponseDtoStatus>;
export type FlagType = NonNullable<DocumentFlagResponseDtoFlagType>;
export type ErrorCode = NonNullable<IngestionJobResponseDto['errorCode']>;
export type Stage = 'QUEUED' | 'PARSING' | 'CHUNKING' | 'EMBEDDING';

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  INDEXED: 'Indexed',
  FAILED: 'Failed',
};

/** The Type filter's options, by stored extension. */
export const FILE_TYPE_LABEL: Partial<
  Record<DocumentResponseDtoFileType, string>
> = { pdf: 'PDF', docx: 'Word', md: 'Markdown', txt: 'Text' };

/** A stored extension in words: "PDF", "Word"; anything else upper-cased. */
export function fileTypeLabel(fileType: string): string {
  return (
    FILE_TYPE_LABEL[fileType as DocumentResponseDtoFileType] ??
    fileType.toUpperCase()
  );
}

export const STAGES: readonly Stage[] = [
  'QUEUED',
  'PARSING',
  'CHUNKING',
  'EMBEDDING',
];

export const STAGE_LABEL: Record<Stage, string> = {
  QUEUED: 'Queued',
  PARSING: 'Parsing',
  CHUNKING: 'Chunking',
  EMBEDDING: 'Embedding',
};

export const OCR_LANGUAGE_LABEL: Record<OcrLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  vi: 'Vietnamese',
  ja: 'Japanese',
  zh: 'Chinese',
};

/**
 * Whether another OCR language may join a choice: the server takes at most
 * one of Japanese and Chinese.
 *
 * @example ocrLanguageAllowed('zh', ['ja']) // false
 */
export function ocrLanguageAllowed(
  language: OcrLanguage,
  chosen: readonly OcrLanguage[],
): boolean {
  return (
    !NON_LATIN_OCR_LANGUAGES.includes(language) ||
    !chosen.some(
      (other) => other !== language && NON_LATIN_OCR_LANGUAGES.includes(other),
    )
  );
}

/** The job statuses a document is still being processed in. */
export const RUNNING: ReadonlySet<string> = new Set(STAGES);

type WithLatestJob = Pick<DocumentResponseDto, 'status' | 'latestJob'>;

/**
 * Whether a document is being processed: its newest attempt hasn't finished.
 * The job says it, not the status: a document that already answers stays
 * `INDEXED` while a replace or reindex runs.
 *
 * @example isWorking({ status: 'INDEXED', latestJob: { status: 'PARSING', … } }) // true
 */
export function isWorking(document: WithLatestJob | undefined): boolean {
  return RUNNING.has(document?.latestJob?.status ?? '');
}

/** Processing again while it answers from the version it has. */
export function isUpdating(document: WithLatestJob): boolean {
  return document.status === 'INDEXED' && isWorking(document);
}

/** Its newest attempt failed, and it still answers from the previous version. */
export function updateFailed(document: WithLatestJob): boolean {
  return (
    document.status === 'INDEXED' && document.latestJob?.status === 'FAILED'
  );
}

/** The stage a running job is in, for the list's caption. */
export function stageCaption(
  job: Pick<IngestionJobResponseDto, 'status' | 'waitingReason'> | null,
): string {
  if (job?.status === 'QUEUED' && job.waitingReason === 'AI_ALLOWANCE') {
    return 'Waiting for the AI allowance to reset';
  }
  switch (job?.status) {
    case 'PARSING':
      return 'Parsing…';
    case 'CHUNKING':
      return 'Chunking…';
    case 'EMBEDDING':
      return 'Embedding…';
    default:
      return 'Queued…';
  }
}

export const UPDATING =
  'Updating — answers use the current version until the new one is ready';

export const UPDATE_FAILED = 'Update failed';

/** What a failed attempt's code means, and what may help. */
export function failure(
  code: ErrorCode | null,
  fileType: string,
): { sentence: string; retry: boolean; replace: boolean } {
  switch (code) {
    case 'TOO_LONG':
      return {
        sentence:
          'This document is too long to process as one. Split it into smaller documents and upload those; retrying won’t help.',
        retry: false,
        replace: true,
      };
    case 'NO_READABLE_TEXT':
      return {
        sentence:
          fileType === 'pdf'
            ? 'We couldn’t find readable text, even with OCR. If it isn’t in English, replace the file and choose its language.'
            : 'We couldn’t find any text in this file. Check that it isn’t empty, then replace it.',
        retry: false,
        replace: true,
      };
    case 'OCR_UNAVAILABLE':
      return {
        sentence:
          'Its scanned pages need OCR, which isn’t set up on this server. The file is fine; ask your administrator.',
        retry: false,
        replace: false,
      };
    case 'PROVIDER_FAILURE':
      return {
        sentence:
          'The AI service didn’t respond while preparing the passages. Retry in a few minutes.',
        retry: true,
        replace: true,
      };
    default:
      return {
        sentence:
          'The file couldn’t be processed. Retry; if it fails again, check that the file opens, or replace it.',
        retry: true,
        replace: true,
      };
  }
}

/** Each flag type: its label, the sentence under it. */
export const FLAG_TYPE: Record<FlagType, { label: string; sentence: string }> =
  {
    OUTDATED: {
      label: 'Out of date',
      sentence: 'The document looks out of date.',
    },
    UNRETRIEVED: {
      label: 'Never found',
      sentence: 'It’s never found for any question.',
    },
    UNCITED: {
      label: 'Found, never cited',
      sentence:
        'It’s found but never cited, so it may crowd out documents that would answer.',
    },
    LOW_CONFIDENCE: {
      label: 'Low confidence',
      sentence: 'Answers rarely use it when they find it.',
    },
    NEGATIVE_FEEDBACK: {
      label: 'Poor feedback',
      sentence: 'People rate answers from it badly.',
    },
    CONFLICTING: {
      label: 'Conflicting',
      sentence: 'It disagrees with another document.',
    },
    PAGES_NOT_INDEXED: {
      label: 'Pages not read',
      sentence:
        'Some pages couldn’t be read; the document is only partly in the corpus.',
    },
  };

/** Where a file goes: one of the accepted types, by its name or its type. */
const MIME_BY_EXTENSION: Record<string, AllowedDocumentMimeType> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
};

/**
 * A chosen file checked before it's sent: its content type, or why it can't
 * go. By extension first, since browsers often give Markdown no type.
 *
 * @example checkFile(new File(['x'], 'deck.pptx')) // { refusal: 'PowerPoint files can’t be uploaded. …' }
 */
export function checkFile(
  file: File,
): { contentType: AllowedDocumentMimeType } | { refusal: string } {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType =
    MIME_BY_EXTENSION[extension] ??
    ALLOWED_DOCUMENT_MIME_TYPES.find((type) => type === file.type);
  if (!contentType) {
    return {
      refusal: `${kindOf(extension)} files can’t be uploaded. Use PDF, Word, Markdown or text.`,
    };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { refusal: 'Larger than 100 MB.' };
  }
  return { contentType };
}

const KINDS: Record<string, string> = {
  pptx: 'PowerPoint',
  ppt: 'PowerPoint',
  xlsx: 'Excel',
  xls: 'Excel',
  doc: 'Word 97–2003',
  csv: 'CSV',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  zip: 'Zip',
};

function kindOf(extension: string): string {
  return KINDS[extension] ?? (extension ? extension.toUpperCase() : 'These');
}

/**
 * The server's sentence for a refusal, ended with a period: every error from
 * the gateway ends in one `!`.
 *
 * @example asSentence('Your document storage is full!') // 'Your document storage is full.'
 */
export function asSentence(message: string): string {
  return message.replace(/!$/, '.');
}

/** The storage bar's level: under 90%, from 90% ("Almost full"), full. */
export function storageLevel(
  usedBytes: number,
  limitBytes: number,
): 'ok' | 'almost' | 'full' {
  if (limitBytes <= 0 || usedBytes >= limitBytes) return 'full';
  return usedBytes / limitBytes >= 0.9 ? 'almost' : 'ok';
}

/**
 * The list's Updated column: "Just now", "Today", then the day.
 *
 * @example updatedLabel('2026-10-02T09:12:00Z', new Date('2026-10-17T09:00:00Z'), 'UTC') // '2 Oct 2026'
 */
export function updatedLabel(
  at: string,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const then = new Date(at);
  if (now.getTime() - then.getTime() < 60_000) return 'Just now';
  const day = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  if (day(then) === day(now)) return 'Today';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(then);
}

/** Who can see a document, as the list's Visibility column says it. */
export function visibilityLabel(
  document: Pick<DocumentResponseDto, 'isOrganizationWide' | 'departmentIds'>,
  departments: ReadonlyMap<string, string>,
): string {
  if (document.isOrganizationWide) return 'Organization-wide';
  return (
    document.departmentIds
      .map((id) => departments.get(id) ?? 'Unknown department')
      .join(', ') || 'No departments'
  );
}
