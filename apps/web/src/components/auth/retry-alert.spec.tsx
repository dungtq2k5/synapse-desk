import { act, render, screen } from '@testing-library/react';
import { RetryAlert } from './retry-alert';

/** Seconds pass one at a time: each tick schedules the next after a render. */
const wait = (seconds: number) => {
  for (let i = 0; i < seconds; i++) act(() => jest.advanceTimersByTime(1000));
};

describe('the retry alert', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('counts down in whole minutes and goes once the wait is over', () => {
    const onOver = jest.fn();
    render(
      <RetryAlert
        title="Too many sign-in attempts"
        what="sign-in is paused"
        seconds={61}
        onOver={onOver}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'For your security, sign-in is paused. Try again in 2 minutes.',
    );

    wait(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Try again in 1 minute.',
    );

    wait(60);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onOver).toHaveBeenCalled();
  });

  it('without Retry-After, says to wait a few minutes and stays', () => {
    render(
      <RetryAlert
        title="Too many requests"
        what="sending is paused"
        seconds={null}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Wait a few minutes, then try again.',
    );

    wait(600);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('a wait already over shows nothing', () => {
    render(
      <RetryAlert
        title="Too many attempts"
        what="this is paused"
        seconds={0}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
