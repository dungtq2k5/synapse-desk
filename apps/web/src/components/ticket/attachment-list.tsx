import {
  CircleAlertIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { fileSize } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Attachment } from './use-attachments';

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
