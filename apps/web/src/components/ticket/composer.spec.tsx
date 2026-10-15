import { act, render, screen } from '@testing-library/react';
import { ApiError } from '@synapsedesk/api-client';
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
    expect(onSend).toHaveBeenCalledWith('Thanks, Priya.', false, {
      attachments: [],
      generatedFromId: null,
    });
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('**sends no typing signal in Internal note mode**, and sends a note', async () => {
    const { onSend, onTyping, user } = setup(true);

    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    await user.type(screen.getByRole('textbox'), 'Check with Finance first.');
    expect(onTyping).not.toHaveBeenCalled();
    expect(screen.getByText('Priya won’t see this note.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    expect(onSend).toHaveBeenCalledWith('Check with Finance first.', true, {
      attachments: [],
      generatedFromId: null,
    });
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
    expect(onSend).toHaveBeenCalledWith('Any update?', false, {
      attachments: [],
      generatedFromId: null,
    });
  });
  describe('Draft with AI', () => {
    const DRAFT = {
      content: 'Hi Priya, you can claim up to **€450**.',
      modelName: 'demo',
      promptTokens: 1,
      completionTokens: 1,
      generationId: 'gen-1',
      citations: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          documentTitle: 'Remote Work Policy.pdf',
          pageNumber: 4,
        },
      ],
    };
    const draftSetup = (
      generateDraft: (
        instruction: string | null,
        signal: AbortSignal,
      ) => Promise<typeof DRAFT>,
    ) => {
      const onSend = jest.fn();
      render(
        <Composer
          agent
          requesterName="Priya Shah"
          onSend={onSend}
          onTyping={jest.fn()}
          generateDraft={generateDraft}
        />,
      );
      return { onSend, user: userEvent.setup() };
    };

    it('**never sends by itself**: the draft lands in the box, then the agent sends it', async () => {
      const generate = jest.fn().mockResolvedValue(DRAFT);
      const { onSend, user } = draftSetup(generate);

      await user.click(screen.getByRole('button', { name: 'Draft with AI' }));
      await user.type(
        screen.getByRole('textbox', { name: 'Instruction (optional)' }),
        'make it shorter',
      );
      await user.click(screen.getByRole('button', { name: 'Generate draft' }));

      expect(
        await screen.findByRole('textbox', { name: 'Reply to Priya' }),
      ).toHaveValue(DRAFT.content);
      expect(generate).toHaveBeenCalledWith(
        'make it shorter',
        expect.any(AbortSignal),
      );
      expect(screen.getByText('AI draft')).toBeInTheDocument();
      expect(
        screen.getByText('[1] Remote Work Policy.pdf · p. 4'),
      ).toBeInTheDocument();
      expect(onSend).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Send reply' }));
      expect(onSend).toHaveBeenCalledWith(DRAFT.content, false, {
        attachments: [],
        generatedFromId: 'gen-1',
      });
      expect(screen.queryByText('AI draft')).not.toBeInTheDocument();
    });

    it('Cancel leaves the box as it was', async () => {
      let signal: AbortSignal | undefined;
      const { onSend, user } = draftSetup(
        (_instruction, given) =>
          new Promise((_resolve, reject) => {
            signal = given;
            given.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

      await user.type(screen.getByRole('textbox'), 'My own words');
      await user.click(screen.getByRole('button', { name: 'Draft with AI' }));
      await user.click(screen.getByRole('button', { name: 'Generate draft' }));
      expect(
        screen.getByText('Writing a draft… This takes a few seconds.'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(signal?.aborted).toBe(true);
      expect(
        screen.getByRole('textbox', { name: 'Reply to Priya' }),
      ).toHaveValue('My own words');
      expect(onSend).not.toHaveBeenCalled();
    });

    it('a 402 says the plan has no AI right now', async () => {
      const { user } = draftSetup(() =>
        Promise.reject(new ApiError(402, { message: 'Payment required' })),
      );

      await user.click(screen.getByRole('button', { name: 'Draft with AI' }));
      await act(() =>
        user.click(screen.getByRole('button', { name: 'Generate draft' })),
      );

      expect(
        await screen.findByText('AI isn’t available on your plan right now'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Write your reply as usual.'),
      ).toBeInTheDocument();
    });
  });

  it('Preview shows the Markdown, and Send still works', async () => {
    const { onSend, user } = setup(true);

    await user.type(screen.getByRole('textbox'), 'Claim **€450**');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByText('€450').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(onSend).toHaveBeenCalledWith('Claim **€450**', false, {
      attachments: [],
      generatedFromId: null,
    });
  });
});
