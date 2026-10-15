import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from '@/lib/utils';

/** The only URLs that become links; anything else stays as its text. */
const LINKABLE = /^(https?:|mailto:)/i;

const heading: Components['h1'] = ({ children }) => (
  <p className="font-semibold">{children}</p>
);

const COMPONENTS: Components = {
  // Headings read as strong body text: a message has no place in the page's
  // outline.
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  a: ({ href, children }) =>
    href && LINKABLE.test(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  code: ({ children }) => (
    <code className="font-mono text-[13px]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-foreground">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
  ),
  // An image is its alt text: nothing in a message loads from elsewhere.
  img: ({ alt }) => <>{alt}</>,
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
  ),
};

/**
 * Markdown, one style wherever it renders: agents' replies, internal notes,
 * the AI's messages and summaries, and the composer's preview. End users'
 * messages are never passed here; they stay plain text.
 *
 * **No raw HTML, ever:** without a rehype plugin, react-markdown shows a
 * message's HTML as the text it is. No images either, and links only to
 * `http(s)` and `mailto`, opened in a new tab. `markdown.spec.tsx` holds this.
 *
 * @example <Markdown>{message.content}</Markdown>
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 break-words', className)}>
      <ReactMarkdown components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
