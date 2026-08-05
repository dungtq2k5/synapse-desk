import {
  CHUNK_TARGET_TOKENS,
  MIN_CHUNK_TOKENS,
  approximateTokens,
} from '@synapsedesk/common';
import { DocumentChunkerService } from './document-chunker.service';

const page = (markdown: string) => [{ pageNumber: 1, markdown }];

/** Long enough to survive MIN_CHUNK_TOKENS, short enough to stay one chunk. */
const body = (label: string) => `${label} `.repeat(MIN_CHUNK_TOKENS * 4);

describe('§3 DocumentChunkerService (unit)', () => {
  const chunker = new DocumentChunkerService();

  describe('structure before length', () => {
    it('1. Splits on HEADINGS, so a chunk is a section rather than an offset', () => {
      const chunks = chunker.chunk(
        page(
          [
            '## Expenses',
            '',
            body('expense'),
            '',
            '## Travel',
            '',
            body('travel'),
          ].join('\n'),
        ),
      );

      expect(chunks).toHaveLength(2);
      expect(chunks[0].contentText).toContain('expense');
      expect(chunks[1].contentText).toContain('travel');
    });

    it('2. Prefixes each chunk with the full heading PATH', () => {
      // "### Travel" alone is nearly as ambiguous as no heading; under
      // "## Expense Policy" it is located. And the path has to be IN the text,
      // because the embedding sees only the text — a heading held in a
      // metadata column is invisible to the component that most needs it.
      const chunks = chunker.chunk(
        page(
          ['## Expense Policy', '', '### Travel', '', body('flight')].join(
            '\n',
          ),
        ),
      );

      expect(chunks[0].contentText).toContain('Expense Policy › Travel');
    });

    it('3. POPS deeper headings, so a later section does not inherit an earlier subsection', () => {
      // Without the pop the path grows monotonically and every later chunk
      // claims headings from sections that ended pages ago — a citation that
      // names the wrong part of the document.
      const chunks = chunker.chunk(
        page(
          [
            '## Expenses',
            '',
            '### Travel',
            '',
            body('flight'),
            '',
            '## Leave',
            '',
            body('holiday'),
          ].join('\n'),
        ),
      );

      const leave = chunks.find((chunk) =>
        chunk.contentText.includes('holiday'),
      );
      expect(leave?.contentText).toContain('Leave');
      expect(leave?.contentText).not.toContain('Travel');
    });

    it('4. Treats a document with NO headings as one section', () => {
      const chunks = chunker.chunk(page(body('plain')));

      expect(chunks).toHaveLength(1);
    });
  });

  describe('length splitting', () => {
    it('5. Splits an oversized section rather than emitting one huge chunk', () => {
      const huge = 'sentence about policy. '.repeat(CHUNK_TARGET_TOKENS);
      const chunks = chunker.chunk(page(`## Policy\n\n${huge}`));

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('6. TERMINATES on text with no paragraph, line or sentence break', () => {
      // Real input — minified data, some CJK text — and the recursion must
      // bottom out in a hard cut rather than looping.
      const unbroken = 'x'.repeat(CHUNK_TARGET_TOKENS * 4 * 3);
      const chunks = chunker.chunk(page(unbroken));

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Allowed to exceed the target somewhat, because the overlap is
        // re-added — but never unboundedly.
        expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS * 2);
      }
    });

    it('7. OVERLAPS adjacent chunks, so a straddling sentence is usable in one of them', () => {
      const sentences = Array.from(
        { length: 200 },
        (_, index) => `Rule ${index} states something specific about policy.`,
      ).join(' ');

      const chunks = chunker.chunk(page(`## Rules\n\n${sentences}`));

      expect(chunks.length).toBeGreaterThan(1);
      // The tail of one chunk reappears at the head of the next.
      const tail = chunks[0].contentText.trim().split(' ').slice(-4).join(' ');
      expect(chunks[1].contentText).toContain(tail);
    });
  });

  describe('what is dropped', () => {
    it('8. DROPS a chunk below the minimum size', () => {
      // A three-token chunk embeds to something, so it can win a similarity
      // comparison, and it carries nothing a generator can use — it then
      // occupies a context slot a useful chunk would have held.
      const chunks = chunker.chunk(page('## Appendix B\n\nSee above.'));

      expect(chunks).toHaveLength(0);
    });

    it('9. Numbers chunks CONTIGUOUSLY after a drop', () => {
      // The index is half of `(document_id, chunk_index)`, so a gap left by a
      // dropped chunk would make the sequence lie about what exists.
      const chunks = chunker.chunk(
        page(
          [
            '## Tiny',
            '',
            'x',
            '',
            '## Real',
            '',
            body('substantive'),
            '',
            '## Also Real',
            '',
            body('more'),
          ].join('\n'),
        ),
      );

      expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    });
  });

  describe('citation metadata', () => {
    it('10. Keeps the PAGE NUMBER on every chunk from that page', () => {
      const chunks = chunker.chunk([
        { pageNumber: 4, markdown: `## Section\n\n${body('four')}` },
        { pageNumber: 5, markdown: `## Section\n\n${body('five')}` },
      ]);

      expect(chunks[0].pageNumber).toBe(4);
      expect(chunks[1].pageNumber).toBe(5);
    });

    it('11. Leaves the page NULL for a format that has none', () => {
      // A DOCX has no pages until something paginates it. "Page 1" of a
      // fifty-page Word document is confidently wrong, and a user who clicks
      // through learns not to trust citations.
      const chunks = chunker.chunk([
        { pageNumber: null, markdown: `## Section\n\n${body('docx')}` },
      ]);

      expect(chunks[0].pageNumber).toBeNull();
    });

    it('12. Reports a token count consistent with the shared estimator', () => {
      // The same function the batching and the size checks use. A chunker with
      // its own private notion of "token" would size chunks against one scale
      // and report them on another.
      const chunks = chunker.chunk(page(`## Section\n\n${body('token')}`));

      expect(chunks[0].tokenCount).toBe(
        approximateTokens(chunks[0].contentText),
      );
    });
  });
});
