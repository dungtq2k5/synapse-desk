import { CHUNK_TARGET_TOKENS, MIN_CHUNK_TOKENS } from '@synapsedesk/common';
import { getEncoding } from 'js-tiktoken';
import {
  DocumentChunkerService,
  rebalanceSentenceEnds,
} from './document-chunker.service';

describe('§3 DocumentChunkerService (unit)', () => {
  const chunker = new DocumentChunkerService();

  const page = (markdown: string) => [{ pageNumber: 1, markdown }];

  /** Long enough to survive MIN_CHUNK_TOKENS, short enough to stay one chunk. */
  const body = (label: string) => `${label} `.repeat(MIN_CHUNK_TOKENS * 4);

  describe('structure before length', () => {
    it('1. Splits on HEADINGS, so a chunk is a section rather than an offset', async () => {
      const chunks = await chunker.chunk(
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

    it('2. Prefixes each chunk with the full heading PATH', async () => {
      // "### Travel" alone is nearly as ambiguous as no heading; under
      // "## Expense Policy" it is located. And the path has to be IN the text,
      // because the embedding sees only the text — a heading held in a
      // metadata column is invisible to the component that most needs it.
      const chunks = await chunker.chunk(
        page(
          ['## Expense Policy', '', '### Travel', '', body('flight')].join(
            '\n',
          ),
        ),
      );

      expect(chunks[0].contentText).toContain('Expense Policy › Travel');
    });

    it('3. POPS deeper headings, so a later section does not inherit an earlier subsection', async () => {
      // Without the pop the path grows monotonically and every later chunk
      // claims headings from sections that ended pages ago — a citation that
      // names the wrong part of the document.
      const chunks = await chunker.chunk(
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

    it('4. Treats a document with NO headings as one section', async () => {
      const chunks = await chunker.chunk(page(body('plain')));

      expect(chunks).toHaveLength(1);
    });
  });

  describe('length splitting', () => {
    it('5. Splits an oversized section rather than emitting one huge chunk', async () => {
      const huge = 'sentence about policy. '.repeat(CHUNK_TARGET_TOKENS);
      const chunks = await chunker.chunk(page(`## Policy\n\n${huge}`));

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('6. TERMINATES on text with no paragraph, line or sentence break', async () => {
      // Real input — minified data, some CJK text — and the recursion must
      // bottom out in a hard cut rather than looping.
      const unbroken = 'x'.repeat(CHUNK_TARGET_TOKENS * 4 * 3);
      const chunks = await chunker.chunk(page(unbroken));

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Allowed to exceed the target somewhat, because the overlap is
        // re-added — but never unboundedly.
        expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS * 2);
      }
    });

    it('7. OVERLAPS adjacent chunks, so a straddling sentence is usable in one of them', async () => {
      const sentences = Array.from(
        { length: 200 },
        (_, index) => `Rule ${index} states something specific about policy.`,
      ).join(' ');

      const chunks = await chunker.chunk(page(`## Rules\n\n${sentences}`));

      expect(chunks.length).toBeGreaterThan(1);
      // The tail of one chunk reappears at the head of the next.
      const tail = chunks[0].contentText.trim().split(' ').slice(-4).join(' ');
      expect(chunks[1].contentText).toContain(tail);
    });
  });

  describe('what is dropped', () => {
    it('8. DROPS a chunk below the minimum size', async () => {
      // A three-token chunk embeds to something, so it can win a similarity
      // comparison, and it carries nothing a generator can use — it then
      // occupies a context slot a useful chunk would have held.
      const chunks = await chunker.chunk(page('## Appendix B\n\nSee above.'));

      expect(chunks).toHaveLength(0);
    });

    it('9. Numbers chunks CONTIGUOUSLY after a drop', async () => {
      // The index is half of `(document_id, chunk_index)`, so a gap left by a
      // dropped chunk would make the sequence lie about what exists.
      const chunks = await chunker.chunk(
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
    it('10. Keeps the PAGE NUMBER on every chunk from that page', async () => {
      const chunks = await chunker.chunk([
        { pageNumber: 4, markdown: `## Section\n\n${body('four')}` },
        { pageNumber: 5, markdown: `## Section\n\n${body('five')}` },
      ]);

      expect(chunks[0].pageNumber).toBe(4);
      expect(chunks[1].pageNumber).toBe(5);
    });

    it('11. Leaves the page NULL for a format that has none', async () => {
      // A DOCX has no pages until something paginates it. "Page 1" of a
      // fifty-page Word document is confidently wrong, and a user who clicks
      // through learns not to trust citations.
      const chunks = await chunker.chunk([
        { pageNumber: null, markdown: `## Section\n\n${body('docx')}` },
      ]);

      expect(chunks[0].pageNumber).toBeNull();
    });

    it('12. Reports a token count consistent with the shared estimator', async () => {
      // The same function the batching and the size checks use. A chunker with
      // its own private notion of "token" would size chunks against one scale
      // and report them on another.
      const chunks = await chunker.chunk(
        page(`## Section\n\n${body('token')}`),
      );

      expect(chunks[0].tokenCount).toBe(
        getEncoding('cl100k_base').encode(chunks[0].contentText).length,
      );
    });
  });

  describe('the AST edge cases the swap is supposed to buy — 21-doc §3.4', () => {
    it('13. **a heading inside a CODE FENCE does not split**', async () => {
      // `# install` in a shell sample is a comment, not a section. Splitting
      // there tears the sample in half and invents a section named after a
      // comment — and the chunk that results begins with a fragment of code
      // under a heading that does not exist in the document.
      //
      // Easy to assume a library covers this. No library does the heading pass
      // at all (21-doc §3.1), so it is pinned here where the tracking lives.
      const chunks = await chunker.chunk(
        page(
          [
            '## Setup',
            '',
            body('prose'),
            '',
            '```bash',
            '# Install the CLI',
            'npm i -g synapsedesk',
            '## not a heading either',
            '```',
            '',
            body('after'),
          ].join('\n'),
        ),
      );

      // Every chunk belongs to "Setup". A fence-blind splitter produces a
      // section called "Install the CLI".
      for (const chunk of chunks) {
        expect(chunk.contentText).not.toContain('Install the CLI\n\n');
      }
      expect(
        chunks.some((chunk) => chunk.contentText.includes('# Install the CLI')),
      ).toBe(true);
    });

    it('14. **breadcrumbs are ordered H1 › H2 › H3, absent levels excluded**', async () => {
      // Trap 4 of 21-doc §3.2: building these with
      // `Object.values(metadata).join(' › ')` relies on key-insertion order to
      // happen to come out in heading order.
      const chunks = await chunker.chunk(
        page(['# Handbook', '', '### Travel', '', body('deep')].join('\n')),
      );

      // H2 is absent and simply does not appear — no empty segment, no
      // placeholder, and the order follows the document.
      expect(chunks[0].contentText).toContain('Handbook › Travel');
      expect(chunks[0].contentText).not.toContain('›  ›');
    });

    it('15. a deeper heading does not leak into a later SIBLING section', async () => {
      const chunks = await chunker.chunk(
        page(
          [
            '# Handbook',
            '## Travel',
            '### Flights',
            '',
            body('flights'),
            '',
            '## Expenses',
            '',
            body('expenses'),
          ].join('\n'),
        ),
      );

      const expenses = chunks.find((chunk) =>
        chunk.contentText.includes('expenses'),
      );

      expect(expenses?.contentText).toContain('Handbook › Expenses');
      expect(expenses?.contentText).not.toContain('Flights');
    });

    it('16. token counts are TIKTOKEN, not chars/4', async () => {
      // The CJK case, where `chars / 4` under-counts by 3.7x — a chunk sized
      // by characters silently overflowed the embedding model's input on
      // exactly the documents least likely to be spot-checked.
      const cjk = '这是一个中文句子，用于测试分词器的准确性。'.repeat(8);

      const chunks = await chunker.chunk(page(`## 政策\n\n${cjk}`));

      const estimated = Math.ceil(chunks[0].contentText.length / 4);
      expect(chunks[0].tokenCount).toBeGreaterThan(estimated);
    });
  });

  describe('§3.5 F2 — the regression the library swap introduced', () => {
    it('17. **a sentence keeps its terminator; no chunk begins with ". "**', async () => {
      // `RecursiveCharacterTextSplitter` splits with a LOOKAHEAD, so a
      // separator lands at the start of the FOLLOWING chunk:
      //
      //   'The policy is clear. There is no exception.'
      //   → ['The policy is clear', '. There is no exception.']
      //
      // The preceding sentence loses its period and the next chunk opens with
      // orphan punctuation — visible in citation previews and mild noise in
      // the embedding. The replaced code used a LOOKBEHIND and kept them
      // together.
      //
      // **All 12 pre-existing chunker tests passed through this regression**,
      // because none of them asserted it. That is the whole reason this test
      // exists.
      const sentences = Array.from(
        { length: 60 },
        (_, index) => `Clause ${index} states the applicable limit clearly.`,
      ).join(' ');

      const chunks = await chunker.chunk(page(`## Rules\n\n${sentences}`));

      expect(chunks.length).toBeGreaterThan(1);

      for (const chunk of chunks) {
        expect(chunk.contentText.trimStart()).not.toMatch(/^[.!?。！？]/);
      }
    });

    it('18. rebalancing does not DELETE the punctuation', async () => {
      // `keepSeparator: false` would have been the one-line "fix" and is
      // worse: it drops the period entirely, so every sentence in the corpus
      // silently loses its terminator.
      const sentences = Array.from(
        { length: 60 },
        (_, index) => `Clause ${index} states the applicable limit clearly.`,
      ).join(' ');

      const chunks = await chunker.chunk(page(`## Rules\n\n${sentences}`));
      const rejoined = chunks.map((chunk) => chunk.contentText).join(' ');

      // Every clause still ends in a period somewhere in the output.
      expect(rejoined).toContain('limit clearly.');
    });

    it('19. rebalanceSentenceEnds is exact on the documented example', () => {
      // The example from 21-doc §3.5 F2, pinned directly so the helper can be
      // reasoned about without running the whole splitter.
      expect(
        rebalanceSentenceEnds([
          'The policy is clear',
          '. There is no exception',
          '. Ask your manager.',
        ]),
      ).toEqual([
        'The policy is clear.',
        'There is no exception.',
        'Ask your manager.',
      ]);
    });

    it('20. leaves a chunk that is ONLY punctuation alone', () => {
      // Moving the terminator would empty it, and an empty chunk shifts every
      // later index. Dropped by the trailing filter instead.
      expect(rebalanceSentenceEnds(['.', 'Real content here'])).toEqual([
        '.',
        'Real content here',
      ]);
    });
  });
});
