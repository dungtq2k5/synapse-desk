import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SubmitFeedbackDto } from './feedback.dto';

/**
 * §2.8 test 2, at the cheapest layer.
 *
 * The rating is constrained in THREE places: here, in ticket-service, and by a
 * Postgres CHECK the seeder applies. That is not paranoia — each catches a
 * different thing. This one gives the caller a 400 they can act on; the service
 * guards non-HTTP callers; the CHECK guards a migration or a psql session.
 */
describe('SubmitFeedbackDto (unit)', () => {
  const validate = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(SubmitFeedbackDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  const failedProperties = (payload: Record<string, unknown>) =>
    validate(payload).map((error) => error.property);

  it('accepts a thumbs-up and a thumbs-down', () => {
    expect(validate({ rating: 1 })).toHaveLength(0);
    expect(validate({ rating: -1 })).toHaveLength(0);
  });

  it('REFUSES zero, which the LIST request uses to mean "no filter"', () => {
    // The load-bearing case. A range check (`@Min(-1) @Max(1)`) would admit 0,
    // and 0 already means something else one layer over — a rating of zero
    // would then mean two different things in two places.
    expect(failedProperties({ rating: 0 })).toContain('rating');
  });

  it('REFUSES a scale value — this is a thumb, not a star rating', () => {
    for (const rating of [2, 5, -2, 10]) {
      expect([rating, failedProperties({ rating })]).toEqual([
        rating,
        ['rating'],
      ]);
    }
  });

  it('REFUSES a missing rating', () => {
    expect(failedProperties({ feedbackText: 'nice' })).toContain('rating');
  });

  it('REFUSES a non-integer rating rather than rounding it', () => {
    expect(failedProperties({ rating: 1.5 })).toContain('rating');
  });

  it('accepts an ABSENT citationAccurate — "not assessed" is a real state', () => {
    const dto = plainToInstance(SubmitFeedbackDto, { rating: 1 });

    expect(validate({ rating: 1 })).toHaveLength(0);
    expect(dto.citationAccurate).toBeUndefined();
  });

  it('keeps citationAccurate FALSE distinct from absent', () => {
    // `false` is an assessment: the citations were wrong. Anything that
    // collapsed it into "unset" would erase the most useful signal in the row.
    const dto = plainToInstance(SubmitFeedbackDto, {
      rating: -1,
      citationAccurate: false,
    });

    expect(dto.citationAccurate).toBe(false);
  });

  it('REFUSES an unknown field rather than dropping it', () => {
    // `userId` in particular: a client trying to rate on somebody else's behalf
    // should be told no, not silently have its own id used.
    expect(
      validate({ rating: 1, userId: '00000000-0000-4000-8000-000000000000' }),
    ).not.toHaveLength(0);
  });

  it('TRIMS feedback text', () => {
    const dto = plainToInstance(SubmitFeedbackDto, {
      rating: 1,
      feedbackText: '  helpful  ',
    });

    expect(dto.feedbackText).toBe('helpful');
  });
});
