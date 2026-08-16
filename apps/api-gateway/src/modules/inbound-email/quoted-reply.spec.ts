import {
  stripQuotedHtml,
  stripQuotedReply,
  toStoredBody,
} from './quoted-reply';

/**
 * Quoted history is stripped, the new text survives.
 *
 * **Fixtures shaped after Gmail, Outlook and Apple Mail, because they quote
 * differently** — and the asymmetry in the assertions is the point: every case
 * checks that the reply SURVIVED as well as that the quote went. Over-stripping
 * loses a customer's message silently, which is strictly worse than leaving a
 * quoted line behind.
 */
describe('quoted reply stripping', () => {
  describe('plain text', () => {
    it('**Gmail — "On … wrote:" and the `>` block below it**', () => {
      const body = [
        'Yes, that fixed it. Thanks!',
        '',
        'On Tue, 11 Aug 2026 at 09:14, Support <support@app.test> wrote:',
        '> Have you tried turning it off and on again?',
        '> — The Support Team',
      ].join('\n');

      const stripped = stripQuotedReply(body);

      expect(stripped).toBe('Yes, that fixed it. Thanks!');
      expect(stripped).not.toContain('turning it off');
    });

    it('**Outlook — the `-----Original Message-----` divider**', () => {
      const body = [
        'Still broken I am afraid.',
        '',
        '-----Original Message-----',
        'From: Support <support@app.test>',
        'Sent: Tuesday, 11 August 2026 09:14',
        'Subject: RE: Printer',
        '',
        'Could you send a photo?',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('Still broken I am afraid.');
    });

    it('**Apple Mail — a wrapped "On … wrote:" header**', () => {
      // The header runs onto a second line, which an anchored single-line
      // pattern would miss entirely — and missing it keeps the whole thread.
      const body = [
        'Confirming this is resolved.',
        '',
        'On 11 Aug 2026, at 09:14, Support',
        '<support@app.test> wrote:',
        '',
        '> Any update?',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('Confirming this is resolved.');
    });

    it('strips a bare `>` block with no header at all', () => {
      const body = [
        'Agreed.',
        '',
        '> the original question',
        '> second line',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('Agreed.');
    });

    it('cuts at the EARLIEST marker in a forwarded chain', () => {
      // A forward carries several headers. Cutting at the last one keeps every
      // quoted block above it, which is the whole thread minus one line.
      const body = [
        'Passing this on.',
        '',
        'On Tue, 11 Aug 2026, A wrote:',
        '> inner',
        '',
        '-----Original Message-----',
        'older still',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('Passing this on.');
    });

    it('**leaves ordinary prose alone, including the words in the markers**', () => {
      // The over-stripping direction. These sentences contain "wrote:" and
      // "From:" mid-line, and an unanchored pattern would truncate the message
      // at the first one — deleting what the customer actually said.
      const body =
        'On Tuesday I wrote: the invoice is wrong. From: my reading of it, ' +
        'the total excludes VAT.';

      expect(stripQuotedReply(body)).toBe(body);
    });

    it('**and returns the original when stripping would empty it**', () => {
      // A message that is entirely quotation is far more likely to be a client
      // this parser does not know than a customer who wrote nothing.
      const body = ['> only quoted text', '> and nothing else'].join('\n');

      expect(stripQuotedReply(body)).toBe(body);
    });

    it('drops the signature after an RFC 3676 delimiter', () => {
      const body = [
        'The short answer is yes.',
        '',
        '-- ',
        'Jane',
        'Acme Ltd',
      ].join('\n');

      expect(stripQuotedReply(body)).toBe('The short answer is yes.');
    });
  });

  describe('html', () => {
    it('cuts at Gmail’s quote container', () => {
      const html =
        '<div dir="ltr">Thanks, that worked.</div>' +
        '<div class="gmail_quote"><blockquote>old thread</blockquote></div>';

      expect(stripQuotedHtml(html)).not.toContain('old thread');
      expect(stripQuotedHtml(html)).toContain('that worked');
    });

    it('cuts at a bare blockquote', () => {
      const html = '<p>Confirmed.</p><blockquote>previous</blockquote>';

      expect(stripQuotedHtml(html)).toBe('<p>Confirmed.</p>');
    });
  });

  describe('choosing what to store', () => {
    it('**prefers the text part when there is one**', () => {
      expect(toStoredBody('the plain part', '<p>the html part</p>')).toBe(
        'the plain part',
      );
    });

    it('falls back to HTML reduced to text', () => {
      const stored = toStoredBody(
        null,
        '<p>First line.</p><p>Second line.</p>',
      );

      expect(stored).toBe('First line.\nSecond line.');
    });

    it('**decodes entities last, so escaped markup cannot become a tag**', () => {
      // `&lt;b&gt;` is a literal in the source. Decoding before stripping tags
      // would turn it into one the stripper has already gone past.
      expect(toStoredBody(null, '<p>use &lt;b&gt; for bold</p>')).toBe(
        'use <b> for bold',
      );
    });

    it('drops script and style content entirely', () => {
      expect(
        toStoredBody(null, '<style>p{color:red}</style><p>Visible.</p>'),
      ).toBe('Visible.');
    });

    it('and answers empty for a message with neither part', () => {
      expect(toStoredBody(null, null)).toBe('');
      expect(toStoredBody('   ', null)).toBe('');
    });
  });
});
