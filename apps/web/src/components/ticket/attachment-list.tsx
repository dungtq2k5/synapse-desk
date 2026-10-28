import {
  CircleAlertIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Attachment } from './use-attachments';

/** What a file may be, said where files are dropped or chosen. */
export const FILE_HINT =
  'PDF, Word, Excel, images, CSV or text. Up to 5 files, 10 MB each.';

/**
 * A drop zone's handlers, and whether files are over it now. Only a drag
 * carrying files counts; leaving for a child of the zone doesn't end it.
 *
 * @param enabled false where files can't be attached, so a drop does nothing
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (event: DragEvent) =>
    enabled && event.dataTransfer.types.includes('Files');
  return {
    dragging,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        onFiles([...event.dataTransfer.files]);
      },
    },
  };
}

/** What a drop zone shows while files are over it. */
export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-accent text-center text-sm text-accent-foreground">
      <UploadIcon aria-hidden className="size-5" />
      <span className="font-medium">Drop files to attach</span>
      <span className="text-xs">{FILE_HINT}</span>
    </div>
  );
}

/** Files on their way: each with its progress, its problem, Retry and remove. */
export function AttachmentList({
  items,
  onRetry,
  onRemove,
}: {
  items: Attachment[];
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-col gap-2">
      {items.map((item) => {
        const bad = item.state !== 'uploading' && item.state !== 'done';
        return (
          <li
            key={item.key}
            className={cn(
              'flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm',
              bad && 'border-destructive-border',
            )}
          >
            {item.state === 'uploading' ? (
              <LoaderCircleIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin"
              />
            ) : bad ? (
              <CircleAlertIcon
                aria-hidden
                className="size-4 shrink-0 text-destructive"
              />
            ) : (
              <FileTextIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{item.name}</span>
              <Meta item={item} />
            </div>
            {item.state === 'failed' && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onRetry(item.key)}
              >
                <RotateCwIcon aria-hidden />
                Retry
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${item.name}`}
              onClick={() => onRemove(item.key)}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Meta({ item }: { item: Attachment }) {
  switch (item.state) {
    case 'uploading':
      return (
        <>
          <span className="text-xs text-muted-foreground">
            Uploading… {item.percent}%
          </span>
          <Progress aria-hidden value={item.percent} className="h-1" />
        </>
      );
    case 'done':
      return (
        <span className="text-xs text-muted-foreground">
          {fileSize(item.file.size)}
        </span>
      );
    case 'failed':
      return <span className="text-xs text-destructive">Upload failed.</span>;
    case 'too-large':
      return (
        <span className="text-xs text-destructive">
          {fileSize(item.file.size)} is over the 10 MB limit.
        </span>
      );
    case 'unsupported':
      return (
        <span className="text-xs text-destructive">
          This file type isn’t supported.
        </span>
      );
  }
}
