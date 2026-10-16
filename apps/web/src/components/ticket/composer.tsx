import {
  ApiError,
  type AiDraftResponseDto,
  type NewAttachmentDto,
} from '@synapsedesk/api-client';
import { ALLOWED_ATTACHMENT_MIME_TYPES } from '@synapsedesk/contracts';
import {
  CircleAlertIcon,
  EyeIcon,
  LockIcon,
  MessageSquareIcon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
  ZapOffIcon,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type SubmitEvent,
} from 'react';
import { Field } from '@/components/auth/field';
import { Markdown } from '@/components/markdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { firstName } from '@/lib/format';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { AttachmentList } from './attachment-list';
import { useAttachments, type Presign } from './use-attachments';

/** How long without a keystroke before "typing" ends. */
const IDLE_MS = 3000;
/**
 * How often "typing" is said again while it goes on: the gateway relays it
 * with a 5 s life (and at most every 2 s), so one signal per burst would
 * vanish from the other side mid-sentence.
 */
const REFRESH_MS = 2000;
const INSTRUCTION_MAX = 500;
const FILE_HINT =
  'PDF, Word, Excel, images, CSV or text. Up to 5 files, 10 MB each.';

/** What goes with a message besides its text. */
export type SendExtras = {
  attachments: NewAttachmentDto[];
  /** The AI draft this reply started from, so the server records its fate. */
  generatedFromId: string | null;
};

type Draft = {
  state: 'idle' | 'writing' | 'unpaid' | 'failed';
  generationId: string | null;
  citations: AiDraftResponseDto['citations'];
};
const NO_DRAFT: Draft = { state: 'idle', generationId: null, citations: [] };

/**
 * The reply box. An agent picks **Reply** or **Internal note** first, and in
 * note mode the whole composer takes the note's surface, so the mode is
 * unmistakable before sending. An end user has one mode.
 *
 * Agents also get **Preview** (their Markdown, rendered) and, given
 * `generateDraft`, **Draft with AI**: the draft lands in the box for the agent
 * to edit, and is never sent by itself. Given `presign`, files attach by the
 * paperclip or by dropping them on the composer.
 *
 * `onTyping` is the typing signal. **Note mode never sends one:** a customer
 * must not see "typing…" for a note they'll never read.
 */
export function Composer({
  agent,
  requesterName,
  onSend,
  onTyping,
  generateDraft,
  presign,
}: {
  agent: boolean;
  /** For the agent's copy; `null` when the requester's name didn't resolve. */
  requesterName: string | null;
  onSend: (
    content: string,
    isInternalNote: boolean,
    extras: SendExtras,
  ) => void;
  onTyping: (typing: boolean) => void;
  generateDraft?: (
    instruction: string | null,
    signal: AbortSignal,
  ) => Promise<AiDraftResponseDto | null | undefined>;
  presign?: Presign;
}) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<Draft>(NO_DRAFT);
  const [dragging, setDragging] = useState(false);
  const files = useAttachments(presign ?? noPresign);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const caret = useRef(0);
  const cancel = useRef<AbortController | null>(null);
  const typing = useRef(false);
  const signalled = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const helpId = useId();
  const limitId = useId();
  const note = agent && mode === 'note';
  const name = requesterName ? firstName(requesterName) : null;
  const writing = draft.state === 'writing';

  const stopTyping = () => {
    globalThis.clearTimeout(idle.current);
    if (typing.current) {
      typing.current = false;
      onTyping(false);
    }
  };

  // Leaving the ticket ends the signal, and any draft being written.
  useEffect(
    () => () => {
      globalThis.clearTimeout(idle.current);
      cancel.current?.abort();
    },
    [],
  );

  const change = (value: string) => {
    setContent(value);
    if (note) return;
    if (!value) return stopTyping();
    if (!typing.current || Date.now() - signalled.current >= REFRESH_MS) {
      typing.current = true;
      signalled.current = Date.now();
      onTyping(true);
    }
    globalThis.clearTimeout(idle.current);
    idle.current = globalThis.setTimeout(stopTyping, IDLE_MS);
  };

  const switchMode = (value: string) => {
    if (value !== 'reply' && value !== 'note') return;
    stopTyping();
    setMode(value);
    announce(
      value === 'note'
        ? 'Internal note. Only agents will see this.'
        : `Reply. ${name ?? 'The requester'} will see this.`,
    );
    if (!preview) textareaRef.current?.focus();
  };

  const togglePreview = (on: boolean) => {
    if (on) caret.current = textareaRef.current?.selectionStart ?? 0;
    setPreview(on);
    if (!on) {
      // Back to the box, with the caret where it was.
      requestAnimationFrame(() => {
        const box = textareaRef.current;
        box?.focus();
        box?.setSelectionRange(caret.current, caret.current);
      });
    }
  };

  const write = async () => {
    if (!generateDraft) return;
    const controller = new AbortController();
    cancel.current = controller;
    setDraft({ ...NO_DRAFT, state: 'writing' });
    try {
      const answer = await generateDraft(
        instruction.trim() || null,
        controller.signal,
      );
      if (!answer) throw new Error('No draft');
      setContent(answer.content);
      setDraft({
        state: 'idle',
        generationId: answer.generationId,
        citations: answer.citations,
      });
      setDrafting(false);
      setInstruction('');
      announce('Draft ready. Review it before sending.');
      textareaRef.current?.focus();
    } catch (error) {
      if (controller.signal.aborted) return;
      setDraft({
        ...NO_DRAFT,
        state:
          error instanceof ApiError && error.status === 402
            ? 'unpaid'
            : 'failed',
      });
    }
  };

  const stopWriting = () => {
    cancel.current?.abort();
    setDraft(NO_DRAFT);
    announce('Draft canceled.');
  };

  const discardDraft = () => {
    setContent('');
    setDraft(NO_DRAFT);
    textareaRef.current?.focus();
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = content.trim();
    if (!text || files.uploading || writing) return;
    stopTyping();
    onSend(text, note, {
      attachments: files.ready,
      generatedFromId: draft.generationId,
    });
    setContent('');
    setDraft(NO_DRAFT);
    setPreview(false);
    files.clear();
  };

  const hasFiles = (event: DragEvent) =>
    Boolean(presign) && event.dataTransfer.types.includes('Files');

  const placeholder = !agent
    ? 'Write a message…'
    : note
      ? 'Write a note for your team…'
      : name
        ? `Write a reply to ${name}…`
        : 'Write a reply…';
  const help = !agent
    ? null
    : note
      ? `${name ?? 'The requester'} won’t see this note.`
      : `${name ?? 'The requester'} will see this reply.`;
  const formName = !agent
    ? 'Message'
    : note
      ? 'Internal note'
      : name
        ? `Reply to ${name}`
        : 'Reply';

  return (
    <form
      aria-label={formName}
      onSubmit={submit}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        if (!files.full) files.add([...event.dataTransfer.files]);
      }}
      className={cn(
        'relative flex flex-col gap-3 rounded-lg border p-3',
        note
          ? 'border-dashed border-note-border bg-note-bg text-note-fg'
          : 'bg-card',
      )}
    >
      {agent && (
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Message type"
            value={mode}
            onValueChange={switchMode}
          >
            <ToggleGroupItem value="reply">
              <MessageSquareIcon aria-hidden />
              Reply
            </ToggleGroupItem>
            <ToggleGroupItem value="note">
              <LockIcon aria-hidden />
              Internal note
            </ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            variant="outline"
            size="sm"
            pressed={preview}
            onPressedChange={togglePreview}
          >
            <EyeIcon aria-hidden />
            Preview
          </Toggle>
          {note && (
            <span className="text-xs font-medium">
              INTERNAL NOTE · Only agents can see this
            </span>
          )}
          {generateDraft && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn('ml-auto', drafting && 'bg-accent')}
              aria-expanded={drafting}
              aria-label="Draft with AI"
              disabled={writing}
              onClick={() => setDrafting((open) => !open)}
            >
              <SparklesIcon aria-hidden />
              <span className="hidden sm:inline">Draft with AI</span>
              <span className="sm:hidden">Draft</span>
            </Button>
          )}
        </div>
      )}

      {(drafting || draft.state !== 'idle') && generateDraft && (
        <DraftPanel
          state={draft.state}
          instruction={instruction}
          replaces={content.trim().length > 0}
          onInstruction={setInstruction}
          onGenerate={() => void write()}
          onCancel={stopWriting}
          onClose={() => {
            setDrafting(false);
            setDraft(NO_DRAFT);
          }}
        />
      )}

      {draft.generationId && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="bg-author-ai-bg text-author-ai-fg">
            <SparklesIcon aria-hidden />
            AI draft
          </Badge>
          <span className="text-muted-foreground">
            Review and edit it before sending.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={discardDraft}
          >
            <XIcon aria-hidden />
            Discard draft
          </Button>
        </div>
      )}

      {preview ? (
        <div
          aria-label={`${formName}, preview`}
          className="min-h-22 rounded-md border bg-muted p-3 text-sm"
        >
          <Markdown>{content}</Markdown>
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          aria-label={formName}
          aria-describedby={help ? helpId : undefined}
          aria-busy={writing || undefined}
          readOnly={writing}
          placeholder={placeholder}
          value={content}
          rows={3}
          className={cn(note && 'bg-background')}
          onChange={(event) => change(event.target.value)}
          onBlur={stopTyping}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      )}

      {draft.generationId && draft.citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">Sources</span>
          {draft.citations.map((citation, index) => (
            <span
              key={citation.chunkId}
              className="rounded-sm border border-author-ai-border px-1.5 py-0.5 font-mono"
            >
              [{index + 1}] {citation.documentTitle}
              {citation.pageNumber !== null && ` · p. ${citation.pageNumber}`}
            </span>
          ))}
        </div>
      )}

      <AttachmentList
        items={files.items}
        onRetry={files.retry}
        onRemove={files.remove}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {presign && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept={ALLOWED_ATTACHMENT_MIME_TYPES.join(',')}
                onChange={(event) => {
                  files.add([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Attach files"
                aria-describedby={files.full ? limitId : undefined}
                disabled={files.full}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon aria-hidden />
              </Button>
            </>
          )}
          <p id={helpId} className="text-xs text-muted-foreground">
            {files.full ? (
              <span id={limitId}>
                5 of 5 files. Remove one to attach another.
              </span>
            ) : (
              help
            )}
          </p>
        </div>
        <Button
          type="submit"
          disabled={!content.trim() || files.uploading || writing}
        >
          {note ? <LockIcon aria-hidden /> : <SendIcon aria-hidden />}
          {!agent ? 'Send' : note ? 'Add internal note' : 'Send reply'}
        </Button>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-accent text-center text-sm text-accent-foreground">
          <UploadIcon aria-hidden className="size-5" />
          <span className="font-medium">Drop files to attach</span>
          <span className="text-xs">{FILE_HINT}</span>
        </div>
      )}
    </form>
  );
}

const noPresign: Presign = () => Promise.resolve(null);

function DraftPanel({
  state,
  instruction,
  replaces,
  onInstruction,
  onGenerate,
  onCancel,
  onClose,
}: {
  state: Draft['state'];
  instruction: string;
  replaces: boolean;
  onInstruction: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted p-3 text-sm text-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <SparklesIcon aria-hidden className="size-4" />
          Draft with AI
        </span>
        {state !== 'writing' && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close draft panel"
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      {state === 'writing' ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground">
            Writing a draft… This takes a few seconds.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : state === 'unpaid' ? (
        <Alert variant="warning" role="alert">
          <ZapOffIcon aria-hidden />
          <AlertTitle>AI isn’t available on your plan right now</AlertTitle>
          <AlertDescription>Write your reply as usual.</AlertDescription>
        </Alert>
      ) : (
        <>
          {state === 'failed' && (
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden />
              <AlertTitle>Couldn’t write a draft</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                Try again, or write your reply as usual.
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={onGenerate}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <Field
            id="draft-instruction"
            label="Instruction (optional)"
            count={{ length: instruction.length, max: INSTRUCTION_MAX }}
          >
            {(aria) => (
              <Input
                id="draft-instruction"
                autoFocus
                maxLength={INSTRUCTION_MAX}
                placeholder="For example: make it shorter"
                value={instruction}
                onChange={(event) => onInstruction(event.target.value)}
                onKeyDown={(event) => {
                  // Enter generates; it never submits the reply.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onGenerate();
                  }
                }}
                {...aria}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={onGenerate}>
              <SparklesIcon aria-hidden />
              Generate draft
            </Button>
            <span className="text-xs text-muted-foreground">
              {replaces
                ? 'The draft replaces what you’ve written.'
                : 'The draft goes into the reply box for you to edit. Nothing is sent.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
