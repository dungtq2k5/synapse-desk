import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from './dialog';

/** A dialog opened from a plain button (no `DialogTrigger`), as most are here. */
function Opened({ next = false }: { next?: boolean }) {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setFirst(true)}>
        Invite people
      </button>
      <Dialog open={first} onOpenChange={setFirst}>
        <DialogContent>
          <DialogTitle>Invite</DialogTitle>
          <button
            type="button"
            onClick={() => {
              setFirst(false);
              if (next) setSecond(true);
            }}
          >
            Preview
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={second} onOpenChange={setSecond}>
        <DialogContent>
          <DialogTitle>Check before sending</DialogTitle>
          <button type="button" onClick={() => setSecond(false)}>
            Done
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('focus after a dialog closes', () => {
  it('goes back to the button that opened it', async () => {
    render(<Opened />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite people' }),
    );
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Invite people' })).toHaveFocus();
  });

  it('goes back to where the flow began, after a dialog that opened another', async () => {
    render(<Opened next />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Invite people' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));

    expect(screen.getByRole('button', { name: 'Invite people' })).toHaveFocus();
  });
});
