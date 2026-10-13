import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './composer';

describe('the composer', () => {
  const setup = (agent: boolean) => {
    const onSend = jest.fn();
    const onTyping = jest.fn();
    render(
      <Composer
        agent={agent}
        requesterName="Priya Shah"
        onSend={onSend}
        onTyping={onTyping}
      />,
    );
    return { onSend, onTyping, user: userEvent.setup() };
  };

  it('sends a reply, signalling typing while the agent writes it', async () => {
    const { onSend, onTyping, user } = setup(true);

    await user.type(screen.getByRole('textbox'), 'Thanks, Priya.');
    expect(onTyping).toHaveBeenCalledWith(true);
    expect(screen.getByText('Priya will see this reply.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(onSend).toHaveBeenCalledWith('Thanks, Priya.', false);
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('**sends no typing signal in Internal note mode**, and sends a note', async () => {
    const { onSend, onTyping, user } = setup(true);

    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    await user.type(screen.getByRole('textbox'), 'Check with Finance first.');
    expect(onTyping).not.toHaveBeenCalled();
    expect(screen.getByText('Priya won’t see this note.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    expect(onSend).toHaveBeenCalledWith('Check with Finance first.', true);
    expect(onTyping).not.toHaveBeenCalled();
  });

  it('says "typing" again while it goes on, no more than every 2 s', async () => {
    jest.useFakeTimers();
    try {
      const onTyping = jest.fn();
      render(
        <Composer
          agent
          requesterName="Priya Shah"
          onSend={jest.fn()}
          onTyping={onTyping}
        />,
      );
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

      await user.type(screen.getByRole('textbox'), 'Th');
      expect(onTyping.mock.calls).toEqual([[true]]);
      jest.advanceTimersByTime(2000);
      await user.type(screen.getByRole('textbox'), 'a');
      expect(onTyping.mock.calls).toEqual([[true], [true]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('switching to a note mid-reply ends the typing signal', async () => {
    const { onTyping, user } = setup(true);

    await user.type(screen.getByRole('textbox'), 'Hi');
    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    expect(onTyping.mock.calls).toEqual([[true], [false]]);
  });

  it('an end user has one mode, and no note to send', async () => {
    const { onSend, user } = setup(false);

    expect(screen.queryByRole('radio', { name: 'Internal note' })).toBeNull();
    await user.type(screen.getByRole('textbox'), 'Any update?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Any update?', false);
  });
});
