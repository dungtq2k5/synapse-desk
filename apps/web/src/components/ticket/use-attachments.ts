'use client';

import type { PresignAttachmentResponseDto } from '@synapsedesk/api-client';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '@synapsedesk/contracts';
import { useCallback, useRef, useState } from 'react';
import { announce } from '@/lib/toast';
import { sendFile } from '@/lib/upload';

export type Attachment = {
  key: string;
  file: File;
  /** The name it's stored under: the file's, shortened to the limit. */
  name: string;
  state: 'uploading' | 'done' | 'failed' | 'too-large' | 'unsupported';
  percent: number;
  objectPath?: string;
};

/** What the server asks for a file, and how a presign is had for it. */
export type Presign = (file: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}) => Promise<PresignAttachmentResponseDto | null | undefined>;

const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_ATTACHMENT_MIME_TYPES);

/** A name over the limit keeps its extension and loses the middle's end. */
export function storedName(name: string): string {
  if (name.length <= MAX_ATTACHMENT_FILE_NAME_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  return (
    name.slice(0, MAX_ATTACHMENT_FILE_NAME_LENGTH - extension.length) +
    extension
  );
}

/** Why a file can't be attached, checked before any upload; null when it can. */
export function refusal(file: File): 'too-large' | 'unsupported' | null {
  if (!ALLOWED.has(file.type)) return 'unsupported';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'too-large';
  return null;
}

/**
 * Files on their way to a message: each checked, then presigned, sent with
 * the method the presign names, and kept as an object path to bind when the
 * message is created. Up to five; a failed one can be retried or removed.
 */
export function useAttachments(presign: Presign) {
  const [items, setItems] = useState<Attachment[]>([]);
  const counter = useRef(0);

  const patch = useCallback(
    (key: string, change: Partial<Attachment>) =>
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, ...change } : item,
        ),
      ),
    [],
  );

  const upload = useCallback(
    async (item: Attachment) => {
      patch(item.key, { state: 'uploading', percent: 0 });
      try {
        const signed = await presign({
          fileName: item.name,
          mimeType: item.file.type,
          fileSizeBytes: item.file.size,
        });
        if (!signed) throw new Error('No upload URL');
        await sendFile(
          signed.uploadUrl,
          signed.uploadMethod,
          item.file,
          (percent) => patch(item.key, { percent }),
        );
        patch(item.key, { state: 'done', objectPath: signed.objectPath });
        announce(`${item.name} attached`);
      } catch {
        patch(item.key, { state: 'failed' });
        announce(`${item.name} failed`);
      }
    },
    [presign, patch],
  );

  // A refused file takes no place: it's shown only to say why.
  const taken = items.filter(
    (item) => item.state !== 'too-large' && item.state !== 'unsupported',
  ).length;

  const add = useCallback(
    (files: File[]) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - taken;
      const added = files
        .slice(0, Math.max(0, room))
        .map((file): Attachment => ({
          key: `file-${++counter.current}`,
          file,
          name: storedName(file.name),
          state: refusal(file) ?? 'uploading',
          percent: 0,
        }));
      if (added.length === 0) return;
      setItems((current) => [...current, ...added]);
      if (added.length > 1) announce(`${added.length} files added`);
      for (const item of added) {
        if (item.state === 'uploading') void upload(item);
      }
    },
    [taken, upload],
  );

  const remove = useCallback(
    (key: string) =>
      setItems((current) => current.filter((item) => item.key !== key)),
    [],
  );

  const retry = useCallback(
    (key: string) => {
      const item = items.find((each) => each.key === key);
      if (item) void upload(item);
    },
    [items, upload],
  );

  return {
    items,
    add,
    remove,
    retry,
    clear: useCallback(() => setItems([]), []),
    full: taken >= MAX_ATTACHMENTS_PER_MESSAGE,
    uploading: items.some((item) => item.state === 'uploading'),
    /** What the message binds: the files that finished uploading. */
    ready: items
      .filter((item) => item.state === 'done' && item.objectPath)
      .map((item) => ({ objectPath: item.objectPath!, fileName: item.name })),
  };
}
