import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding, type Tiktoken } from 'js-tiktoken';
import {
  CHUNK_HEADING_LEVELS,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  CHUNK_TOKENIZER,
  MIN_CHUNK_TOKENS,
} from '@synapsedesk/common';
import { ParsedPage } from './document-parser.service';

export type Chunk = {
  chunkIndex: number;
  contentText: string;
  pageNumber: number | null;
  tokenCount: number;
};

/**
 * A markdown ATX heading.
 *
 * **Anchored and non-ambiguous**, which the previous pattern was not: it was
 * `/^(#{1,6})\s+(.*)$/` and carried a standing linter suppression for
 * super-linear backtracking, because `\s+` followed by `.*` can divide the
 * whitespace between the two groups in many ways. `[^\S\n]` is "whitespace but
 * not a newline", so there is exactly one way to match and nothing to
 * backtrack over.
 */
const HEADING_PATTERN = /^(#{1,6})[^\S\n]+(\S.*)$/;

/** The separators pass 2 splits on, largest natural boundary first. */
const RECURSIVE_SEPARATORS = [
  // Paragraph, then line, then sentence, then word. Written as real escapes,
  // which is **trap 3**: separators written `['nn', 'n', …]` are
  // the literal letters `n` and `s` rather than `\n` and `\s`, and a splitter
  // configured that way splits text on the letter "n".
  '\n\n',
  '\n',
  '。',
  '！',
  '？',
  '. ',
  '! ',
  '? ',
  ' ',
  '',
];

/**
 * Markdown -> chunks, splitting on STRUCTURE first and length second
 *
 * The ordering is the whole design. Splitting purely by length cuts through the
 * middle of sections, so a chunk begins mid-sentence under no heading and the
 * citation it produces can only be a character offset. Splitting on headings
 * first means a chunk is a section, and "page 4, §2.1" is a fact about the
 * document rather than a computed position.
 *
 * **The heading path is kept IN the chunk text, not only in metadata.** A
 * paragraph reading "this must be approved in advance" is ambiguous alone and
 * unambiguous under "Expense Policy › Travel" — and the embedding sees only the
 * text, so a heading held in a metadata column is invisible to the one
 * component that most needs it.
 *
 * **Pass 1 is ours; pass 2 is `RecursiveCharacterTextSplitter`**,
 * which states that heading extraction stays custom.
 *
 * `MarkdownHeaderTextSplitter` is the obvious candidate for pass 1 and is
 * **trap 5 of §3.2: it does not exist in `@langchain/textsplitters`**. It is a
 * Python-LangChain class; the JS package exports `CharacterTextSplitter`,
 * `LatexTextSplitter`, `MarkdownTextSplitter`, `RecursiveCharacterTextSplitter`,
 * `TextSplitter` and `TokenTextSplitter`. `MarkdownTextSplitter` is not a
 * substitute: it splits on markdown syntax without extracting the heading path,
 * which is the one thing that pass exists to produce.
 *
 * So the heading walk below stays, and the library does the length-bounded
 * splitting it is genuinely better at.
 */
@Injectable()
export class DocumentChunkerService {
  /**
   * The tokenizer, built once.
   *
   * `getEncoding` parses a large BPE table, so constructing it per document
   * would put that cost on every ingestion job. It is pure and stateless, so
   * one instance is safe to share.
   */
  private readonly encoder: Tiktoken = getEncoding(CHUNK_TOKENIZER);

  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_TARGET_TOKENS,
    chunkOverlap: CHUNK_OVERLAP_TOKENS,
    separators: RECURSIVE_SEPARATORS,
    // **Measured in TOKENS, not characters** — the reason for the whole swap.
    // `chars / 4` under-counts CJK by 3.7x (measured: 6 estimated, 22 real),
    // so a chunk sized by characters silently overflowed the embedding
    // model's input on exactly the documents least likely to be spot-checked.
    lengthFunction: (text: string) => this.countTokens(text),
  });

  async chunk(pages: ParsedPage[]): Promise<Chunk[]> {
    const chunks: Chunk[] = [];

    for (const page of pages) {
      for (const section of this.splitByHeadings(page.markdown)) {
        const pieces = rebalanceSentenceEnds(
          await this.splitter.splitText(section),
        );

        for (const text of pieces) {
          const trimmed = text.trim();
          const tokenCount = this.countTokens(trimmed);

          // Dropped rather than stored. A three-token chunk embeds to
          // something, so it can win a similarity comparison, and it carries
          // nothing a generator can use — it then occupies a context slot a
          // useful chunk would have held.
          if (tokenCount < MIN_CHUNK_TOKENS) continue;

          chunks.push({
            chunkIndex: chunks.length,
            contentText: trimmed,
            pageNumber: page.pageNumber,
            tokenCount,
          });
        }
      }
    }

    return chunks;
  }

  /** Exact for `cl100k_base`; an estimate for Gemini — see `CHUNK_TOKENIZER`. */
  private countTokens(text: string): number {
    return this.encoder.encode(text).length;
  }

  /**
   * Sections, each prefixed with its heading PATH.
   *
   * The path rather than the immediate heading: "Travel" alone is nearly as
   * ambiguous as no heading at all, while "Expense Policy › Travel" locates the
   * section in the document. Both the reader and the embedding get the same
   * context, which is the point.
   *
   * **Ordered by heading LEVEL, which is trap 4.** Building
   * breadcrumbs with `Object.values(metadata).join(…)` relies on key-insertion
   * order to happen to produce H1 › H2 › H3. The
   * `path.filter(entry => entry.level < level)` below gets it right by
   * construction, and keeping it was a stated goal of the change rather than an
   * accident of not rewriting it.
   */
  private splitByHeadings(markdown: string): string[] {
    const lines = markdown.split('\n');
    const sections: string[] = [];

    let path: Array<{ level: number; text: string }> = [];
    let buffer: string[] = [];
    let inFence = false;

    const flush = () => {
      const body = buffer.join('\n').trim();
      if (!body) {
        buffer = [];
        return;
      }

      const heading = path.map((entry) => entry.text).join(' › ');
      sections.push(heading ? `${heading}\n\n${body}` : body);
      buffer = [];
    };

    for (const line of lines) {
      // **A `#` inside a fenced code block is not a heading** — it is a comment
      // in shell or Python, or a CSS id. Splitting there tears a code sample in
      // half and invents a section named after a comment.
      //
      // Easy to assume a library handles this. No library does the heading pass
      // at all, so the tracking lives here.
      if (isFence(line)) {
        inFence = !inFence;
        buffer.push(line);
        continue;
      }

      const match = inFence ? null : HEADING_PATTERN.exec(line);
      const level = match ? match[1].length : 0;

      if (
        match &&
        (CHUNK_HEADING_LEVELS as readonly number[]).includes(level)
      ) {
        flush();

        // Pop deeper-or-equal headings before pushing: an `##` after an `###`
        // closes that subsection rather than nesting under it. Without this the
        // path grows monotonically and every later chunk inherits headings from
        // sections that ended pages ago.
        path = path.filter((entry) => entry.level < level);
        path.push({ level, text: match[2].trim() });
        continue;
      }

      buffer.push(line);
    }

    flush();

    // A document with no headings at all is one section, which then falls to
    // length splitting. That is the correct answer for plain text rather than a
    // degenerate case to special-case.
    return sections.length > 0 ? sections : [markdown];
  }
}

/**
 * Moves a stranded sentence terminator back onto the chunk it belongs to —
 * F2.
 *
 * **The one behaviour the library swap lost.** `RecursiveCharacterTextSplitter`
 * splits with a LOOKAHEAD, so a separator lands at the start of the *following*
 * chunk:
 *
 * ```txt
 * 'The policy is clear. There is no exception.'
 * → ['The policy is clear', '. There is no exception.']
 * ```
 *
 * The preceding sentence loses its terminator and the next chunk opens with
 * orphan punctuation — visible in citation previews, and mild noise in the
 * embedding. The replaced code split on `(?<=[.!?。！？])\s+`, a LOOKBEHIND,
 * which kept the punctuation with the sentence it belonged to.
 *
 * `keepSeparator: false` is not the fix: it deletes the period outright.
 *
 * All 12 pre-existing chunker tests passed through this regression because none
 * of them asserted it — which is why §3.5's test 3 exists.
 */
export function rebalanceSentenceEnds(pieces: string[]): string[] {
  const out = [...pieces];

  for (let index = 1; index < out.length; index++) {
    const match = LEADING_TERMINATOR.exec(out[index]);
    if (!match) continue;

    // Only ever moves a terminator ONTO a chunk that has text to attach it to.
    // A chunk that is nothing but punctuation is left alone rather than
    // emptied, which would shift every later index.
    const previous = out[index - 1].trimEnd();
    if (!previous) continue;

    out[index - 1] = `${previous}${match[1]}`;
    out[index] = out[index].slice(match[0].length).trimStart();
  }

  return out.filter((piece) => piece.trim().length > 0);
}

/**
 * A terminator orphaned at the start of a chunk, plus the whitespace after it.
 *
 * Anchored, with a single-character class and a bounded whitespace run — no
 * ambiguity for a backtracking engine to explore.
 */
const LEADING_TERMINATOR = /^([.!?。！？])[^\S\n]*/;

/** ``` or ~~~ opening or closing a fenced block. */
function isFence(line: string): boolean {
  const trimmed = line.trimStart();

  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}
