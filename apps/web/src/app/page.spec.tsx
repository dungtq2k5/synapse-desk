import { render, screen } from '@testing-library/react';
import Home from './page';

describe('the home page', () => {
  it('renders its heading', () => {
    render(<Home />);
    expect(
      screen.getByRole('heading', { name: 'SynapseDesk' }),
    ).toBeInTheDocument();
  });
});
