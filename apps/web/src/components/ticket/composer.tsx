'use client';

import { LockIcon, MessageSquareIcon, SendIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { firstName } from '@/lib/format';
import { announce } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** How long without a keystroke before "typing" ends. */
const IDLE_MS = 3000;
/**
 * How often "typing" is said again while it goes on: the gateway relays it
 * with a 5 s life (and at most every 2 s), so one signal per burst would
 * vanish from the other side mid-sentence.
 */
const REFRESH_MS = 2000;

/**
 * The reply box. An agent picks **Reply** or **Internal note** first, and in
 * note mode the whole composer takes the note's surface, so the mode is
 * unmistakable before sending. An end user has one mode.
 *
 * `onTyping` is the typing signal. **Note mode never sends one:** a customer
 * must not see "typing…" for a note they'll never read.
 */
export function Composer({
  agent,
  requesterName,
  onSend,
  onTyping,
}: {
  agent: boolean;
  /** For the agent's copy; `null` when the requester's name didn't resolve. */
  requesterName: string | null;
  onSend: (content: string, isInternalNote: boolean) => void;
  onTyping: (typing: boolean) => void;
}) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typing = useRef(false);
  const signalled = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const helpId = useId();
  const note = agent && mode === 'note';
  const name = requesterName ? firstName(requesterName) : null;

  const stopTyping = () => {
    globalThis.clearTimeout(idle.current);
    if (typing.current) {
      typing.current = false;
      onTyping(false);
    }
  };

  // Leaving the ticket ends the signal too.
  useEffect(() => () => globalThis.clearTimeout(idle.current), []);

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
    textareaRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = content.trim();
    if (!text) return;
    stopTyping();
    onSend(text, note);
    setContent('');
  };

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
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3',
        note
          ? 'border-dashed border-note-border bg-note-bg text-note-fg'
          : 'bg-card',
      )}
    >
      {agent && (
        <div className="flex items-center gap-3">
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
          {note && (
            <span className="text-xs font-medium">
              INTERNAL NOTE · Only agents can see this
            </span>
          )}
        </div>
      )}
      <Textarea
        ref={textareaRef}
        aria-label={formName}
        aria-describedby={help ? helpId : undefined}
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
      <div className="flex items-center justify-between gap-3">
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
        <Button type="submit" disabled={!content.trim()}>
          {note ? <LockIcon aria-hidden /> : <SendIcon aria-hidden />}
          {!agent ? 'Send' : note ? 'Add internal note' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}
