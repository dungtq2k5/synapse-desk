import { fireEvent, render, screen } from '@testing-library/react';
import GlobalError from './global-error';

jest.mock('@/lib/client-errors', () => ({ reportClientError: jest.fn() }));

/** jsdom's `location` can't be stubbed; a navigation it reports instead. */
const navigated = (errors: jest.SpyInstance) =>
  errors.mock.calls.some((call) =>
    String(call[0]).includes('Not implemented: navigation'),
  );

describe('GlobalError', () => {
  it('**Reload reloads the page**, not a re-render in place', () => {
    // Also silences React on the <html> it renders inside the test's <div>.
    const errors = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(<GlobalError error={new Error('root failed')} />);
    expect(navigated(errors)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(navigated(errors)).toBe(true);
  });
});
