import {
  addTicketStats,
  citationAccuracy,
  csat,
  deflectionRate,
  draftAcceptanceRate,
  EMPTY_AI_STATS,
  EMPTY_TICKET_STATS,
  emptyRetrievalRate,
  humanFirstResponseSeconds,
  aiFirstResponseSeconds,
  meanOf,
  rateOf,
  resolutionSeconds,
} from './analytics.config';

/**
 * The DEFINITIONS
 *
 * **Step 2 of the build order is not documentation, it is this file's subject.**
 * Every metric here has a plausible alternative reading, and two endpoints
 * computing "deflection" differently is worse than not having it — so the
 * definitions are named functions, and these tests are what pin them when
 * somebody re-argues one in six months.
 *
 * Tested where they are DEFINED rather than through an endpoint: an endpoint
 * test proves this tenant's number, and these prove the arithmetic.
 */
describe('the analytics definitions', () => {
  const ticketStats = (overrides = {}) => ({
    ...EMPTY_TICKET_STATS,
    ...overrides,
  });

  const aiStats = (overrides = {}) => ({ ...EMPTY_AI_STATS, ...overrides });

  describe('rateOf — the one division', () => {
    it('returns the rate WITH its denominator', () => {
      // A percentage with a hidden denominator is how "our CSAT is 100%" gets
      // into a board deck on two responses. The shape makes that awkward on
      // purpose: there is no bare number to read.
      expect(rateOf(7, 10)).toEqual({
        rate: 0.7,
        numerator: 7,
        denominator: 10,
      });
    });

    it('**returns NULL, not zero, when there is nothing to divide**', () => {
      // "Nobody has rated anything" and "everybody rated it negative" are
      // different facts. Rendering the first as 0% is a wrong answer rather
      // than a missing one — and a dashboard cannot tell them apart afterwards.
      expect(rateOf(0, 0)).toEqual({
        rate: null,
        numerator: 0,
        denominator: 0,
      });
    });

    it('meanOf follows the same rule', () => {
      expect(meanOf(300, 3)).toEqual({ mean: 100, count: 3 });
      expect(meanOf(0, 0)).toEqual({ mean: null, count: 0 });
    });
  });

  describe('deflection', () => {
    it('is resolved-without-escalation over CHAT CONVERSATIONS', () => {
      const stats = ticketStats({
        chatConversations: 100,
        chatResolvedWithoutEscalation: 70,
        // Deliberately present and deliberately ignored: an email ticket never
        // had a chance to be deflected.
        ticketsCreated: 400,
      });

      expect(deflectionRate(stats)).toEqual({
        rate: 0.7,
        numerator: 70,
        denominator: 100,
      });
    });

    it('is **NOT `1 − tickets/conversations`**', () => {
      // The alternative reading, pinned as wrong. Including agent- and
      // email-created tickets makes the number move when the AI did nothing
      // differently — a metric that changes because a customer changed how they
      // file tickets is worse than no metric.
      const stats = ticketStats({
        chatConversations: 10,
        chatResolvedWithoutEscalation: 5,
        ticketsCreated: 1_000,
      });

      expect(deflectionRate(stats).rate).toBe(0.5);
      // The alternative would be 1 − 1000/10, which is not even in [0, 1].
      expect(deflectionRate(stats).rate).not.toBe(1 - 1_000 / 10);
    });

    it('is null for a tenant with no conversations', () => {
      expect(deflectionRate(ticketStats()).rate).toBeNull();
    });
  });

  describe('first response', () => {
    it('**keeps HUMAN and AI apart**', () => {
      // The metric-measuring-itself guard. An AI reply in 2 seconds genuinely
      // is a first response — and blending it with human response time produces
      // a headline that improves whenever AI usage rises.
      const stats = ticketStats({
        firstResponseSecondsSum: 3_600,
        firstResponseCount: 1,
        aiFirstResponseSecondsSum: 2,
        aiFirstResponseCount: 1,
      });

      expect(humanFirstResponseSeconds(stats).mean).toBe(3_600);
      expect(aiFirstResponseSeconds(stats).mean).toBe(2);
      // The blended figure a single function would produce.
      expect(humanFirstResponseSeconds(stats).mean).not.toBe(1_801);
    });
  });

  describe('CSAT', () => {
    it('divides by positives PLUS negatives, never by ticket count', () => {
      const stats = ticketStats({
        feedbackPositive: 9,
        feedbackNegative: 1,
        ticketsCreated: 1_000,
      });

      expect(csat(stats)).toEqual({
        rate: 0.9,
        numerator: 9,
        denominator: 10,
      });
    });

    it('reports the denominator, so two ratings cannot read as 100%', () => {
      // Response rates on feedback are low single digits, so the denominator is
      // not context — it is most of the information.
      const stats = ticketStats({ feedbackPositive: 2, feedbackNegative: 0 });

      expect(csat(stats).rate).toBe(1);
      expect(csat(stats).denominator).toBe(2);
    });
  });

  describe('citation accuracy', () => {
    it('divides by the ratings that ANSWERED the question', () => {
      // `citation_accurate` is nullable — a thumbs-up with no opinion on the
      // citation is not a vote either way, and counting it as a denominator
      // would understate accuracy for every tenant.
      const stats = ticketStats({
        citationAccurateCount: 8,
        citationRatedCount: 10,
        feedbackPositive: 50,
      });

      expect(citationAccuracy(stats)).toEqual({
        rate: 0.8,
        numerator: 8,
        denominator: 10,
      });
    });
  });

  describe('draft acceptance', () => {
    it('**divides by accepted + edited + DISCARDED**', () => {
      const stats = aiStats({
        draftsAccepted: 6,
        draftsEdited: 2,
        draftsDiscarded: 2,
      });

      expect(draftAcceptanceRate(stats)).toEqual({
        rate: 0.6,
        numerator: 6,
        denominator: 10,
      });
    });

    it('counts EDITED against acceptance', () => {
      // An agent who rewrote the draft did not accept it, even though they sent
      // something.
      const stats = aiStats({ draftsAccepted: 1, draftsEdited: 1 });

      expect(draftAcceptanceRate(stats).rate).toBe(0.5);
    });

    it('reports ~100% WITHOUT the discarded sweep — the failure it guards', () => {
      // The denominator needs `DISCARDED`, which comes from the sweep (
      // §4.3). Without those rows the denominator only ever contains drafts
      // that were USED, and acceptance cannot go down — the clearest possible
      // sign a metric is measuring nothing.
      const withSweep = aiStats({ draftsAccepted: 6, draftsDiscarded: 94 });
      const withoutSweep = aiStats({ draftsAccepted: 6 });

      expect(draftAcceptanceRate(withSweep).rate).toBe(0.06);
      expect(draftAcceptanceRate(withoutSweep).rate).toBe(1);
    });
  });

  describe('empty retrievals', () => {
    it('is the share of generations that retrieved nothing', () => {
      const stats = aiStats({ generations: 100, emptyRetrievals: 5 });

      expect(emptyRetrievalRate(stats)).toEqual({
        rate: 0.05,
        numerator: 5,
        denominator: 100,
      });
    });
  });

  describe('adding rows', () => {
    it('sums every counter, so a weekly rate is one division', () => {
      // **Not an average of daily rates.** That weights a Tuesday with 3
      // conversations equally with a Monday with 300 — the mistake the rollup
      // schema exists to prevent, arriving one layer up.
      const monday = ticketStats({
        chatConversations: 300,
        chatResolvedWithoutEscalation: 150,
      });
      const tuesday = ticketStats({
        chatConversations: 3,
        chatResolvedWithoutEscalation: 3,
      });

      const week = addTicketStats(monday, tuesday);

      expect(deflectionRate(week).rate).toBeCloseTo(153 / 303, 10);
      // The average-of-averages answer, which is nearly 25 points higher.
      const averageOfRates =
        (deflectionRate(monday).rate! + deflectionRate(tuesday).rate!) / 2;
      expect(averageOfRates).toBeCloseTo(0.75, 2);
      expect(deflectionRate(week).rate).not.toBeCloseTo(averageOfRates, 2);
    });

    it('is identity over the empty stats', () => {
      const stats = ticketStats({ ticketsCreated: 5 });

      expect(addTicketStats(EMPTY_TICKET_STATS, stats)).toEqual(stats);
    });
  });

  describe('resolution time', () => {
    it('reports the count, so a reader knows how much of the queue it covers', () => {
      // The figure is biased OPTIMISTIC by construction: it can only see
      // tickets that closed, so a ticket open for 40 days is invisible to it.
      // The count is what makes that visible without a second endpoint.
      const stats = ticketStats({
        resolutionSecondsSum: 86_400,
        resolutionCount: 2,
      });

      expect(resolutionSeconds(stats)).toEqual({ mean: 43_200, count: 2 });
    });
  });
});
