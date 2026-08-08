import { Injectable } from '@nestjs/common';
import {
  approximateTokens,
  CHUNK_HEADING_LEVELS,
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  CHARS_PER_TOKEN,
  MIN_CHUNK_TOKENS,
} from '@synapsedesk/common';
import { ParsedPage } from './document-parser.service';

export type Chunk = {
  chunkIndex: number;
  contentText: string;
  pageNumber: number | null;
  tokenCount: number;
};

// FIXME Simplify this regular expression to reduce its runtime, as it has super-linear performance due to backtracking.
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

/**
 * Markdown -> chunks, splitting on STRUCTURE first and length second.
 *
 * This is `ingestion.md`'s `MarkdownHeaderTextSplitter` with a recursive
 * fallback, and the ordering is the whole design. Splitting purely by length
 * cuts through the middle of sections, so a chunk begins mid-sentence under no
 * heading and the citation it produces can only be a character offset.
 * Splitting on headings first means a chunk is a section, and "page 4, §2.1" is
 * a fact about the document rather than a computed position.
 *
 * **The heading path is kept IN the chunk text, not only in metadata.** A
 * paragraph reading "this must be approved in advance" is ambiguous alone and
 * unambiguous under "## Expense Policy › ### Travel" — and the embedding sees
 * only the text, so a heading held in a metadata column is invisible to the
 * one component that most needs it.
 */
@Injectable()
export class DocumentChunkerService {
  chunk(pages: ParsedPage[]): Chunk[] {
    const chunks: Chunk[] = [];

    for (const page of pages) {
      for (const section of this.splitByHeadings(page.markdown)) {
        for (const text of this.splitByLength(section)) {
          const trimmed = text.trim();
          const tokenCount = approximateTokens(trimmed);

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

  /**
   * Sections, each prefixed with its heading PATH.
   *
   * The path rather than the immediate heading: "### Travel" alone is nearly as
   * ambiguous as no heading at all, while "## Expense Policy › ### Travel"
   * locates the section in the document. Both the reader and the embedding get
   * the same context, which is the point.
   */
  private splitByHeadings(markdown: string): string[] {
    const lines = markdown.split('\n');
    const sections: string[] = [];

    let path: Array<{ level: number; text: string }> = [];
    let buffer: string[] = [];

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
      const match = HEADING_PATTERN.exec(line);
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

  /**
   * Length splitting, recursive: paragraphs, then lines, then sentences.
   *
   * Each level is tried before the next, so a split happens at the largest
   * natural boundary that fits. A single hard character cut is the last resort,
   * reached only by text with no paragraph, line or sentence break in 512
   * tokens — which is real (minified data, some CJK text) and must terminate
   * rather than loop.
   */
  private splitByLength(text: string): string[] {
    if (approximateTokens(text) <= CHUNK_TARGET_TOKENS) return [text];

    const pieces = this.recursiveSplit(text, [
      /\n\n+/,
      /\n/,
      /(?<=[.!?。！？])\s+/,
    ]);

    return this.mergeWithOverlap(pieces);
  }

  private recursiveSplit(text: string, separators: RegExp[]): string[] {
    if (approximateTokens(text) <= CHUNK_TARGET_TOKENS) return [text];

    const [separator, ...rest] = separators;
    if (!separator) return this.hardSplit(text);

    const parts = text.split(separator).filter((part) => part.trim());
    if (parts.length <= 1) return this.recursiveSplit(text, rest);

    return parts.flatMap((part) => this.recursiveSplit(part, rest));
  }

  /** The terminating case: fixed-width cuts on text with no boundary at all. */
  private hardSplit(text: string): string[] {
    const size = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN;
    const parts: string[] = [];

    for (let start = 0; start < text.length; start += size) {
      parts.push(text.slice(start, start + size));
    }

    return parts;
  }

  /**
   * Re-assembles the pieces up to the target size, carrying an overlap.
   *
   * The overlap is what stops a sentence straddling a boundary from being
   * unusable in both chunks — the retriever finds half an answer and the
   * generator reports the rest missing. The cost is duplicated storage, which
   * is much the cheaper of the two problems.
   */
  private mergeWithOverlap(pieces: string[]): string[] {
    const merged: string[] = [];
    let current: string[] = [];
    let tokens = 0;

    for (const piece of pieces) {
      const pieceTokens = approximateTokens(piece);

      if (tokens + pieceTokens > CHUNK_TARGET_TOKENS && current.length > 0) {
        merged.push(current.join('\n'));

        const overlap = this.tailWithin(current, CHUNK_OVERLAP_TOKENS);
        current = [...overlap];
        tokens = overlap.reduce(
          (total, entry) => total + approximateTokens(entry),
          0,
        );
      }

      current.push(piece);
      tokens += pieceTokens;
    }

    if (current.length > 0) merged.push(current.join('\n'));

    return merged;
  }

  /** The last pieces fitting in `budget` tokens, in order. */
  private tailWithin(pieces: string[], budget: number): string[] {
    const tail: string[] = [];
    let tokens = 0;

    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const pieceTokens = approximateTokens(pieces[index]);
      if (tokens + pieceTokens > budget) break;

      tail.unshift(pieces[index]);
      tokens += pieceTokens;
    }

    return tail;
  }
}
