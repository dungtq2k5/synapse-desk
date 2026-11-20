import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { renderSettings as render } from '@/test/settings';
import {
  DeleteDocumentDialog,
  EditDocumentDialog,
  useDocumentActions,
} from './document-actions';

const DOC = { id: 'd1', title: 'Remote Work Policy.pdf' };

/** The row actions, as buttons a test can press. */
function Actions() {
  const { restore, reindex } = useDocumentActions();
  return (
    <>
      <button type="button" onClick={() => void restore(DOC)}>
        restore
      </button>
      <button type="button" onClick={() => void reindex(DOC)}>
        reindex
      </button>
    </>
  );
}

describe('restore and reindex', () => {
  it('restores, saying so', async () => {
    stubApi({ 'POST /api/v1/documents/d1/restore': ok({}) });
    render(<Actions />);
    await userEvent.click(screen.getByRole('button', { name: 'restore' }));
    expect(
      await screen.findByText('Remote Work Policy.pdf restored.'),
    ).toBeInTheDocument();
  });

  it('a restore refused for a duplicate file says what to do; another, the server’s words', async () => {
    stubApi({ 'POST /api/v1/documents/d1/restore': fail(409, 'Duplicate!') });
    const first = render(<Actions />);
    await userEvent.click(screen.getByRole('button', { name: 'restore' }));
    expect(
      await screen.findByText(/Another document has the same file/),
    ).toBeInTheDocument();
    first.unmount();

    stubApi({ 'POST /api/v1/documents/d1/restore': fail(500, 'Down!') });
    render(<Actions />);
    await userEvent.click(screen.getByRole('button', { name: 'restore' }));
    expect(await screen.findByText('Down!')).toBeInTheDocument();
  });

  it('reindexes, and says when it couldn’t', async () => {
    stubApi({ 'POST /api/v1/documents/d1/reindex': ok({}) });
    const first = render(<Actions />);
    await userEvent.click(screen.getByRole('button', { name: 'reindex' }));
    expect(
      await screen.findByText('Reindexing Remote Work Policy.pdf.'),
    ).toBeInTheDocument();
    first.unmount();

    stubApi({ 'POST /api/v1/documents/d1/reindex': fail(500, 'Down!') });
    render(<Actions />);
    await userEvent.click(screen.getByRole('button', { name: 'reindex' }));
    expect(await screen.findByText('Couldn’t reindex it')).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('deletes, then offers Undo, which restores it', async () => {
    const calls = stubApi({
      'DELETE /api/v1/documents/d1': ok({}),
      'POST /api/v1/documents/d1/restore': ok({}),
    });
    const onDeleted = jest.fn();
    render(
      <DeleteDocumentDialog
        document={DOC}
        open
        onOpenChange={() => undefined}
        onDeleted={onDeleted}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Delete/ }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    // The dialog stays open in this test, so its overlay blocks the pointer.
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.endsWith('/documents/d1/restore')),
      ).toBe(true),
    );
  });

  it('says when deleting failed, and doesn’t report it deleted', async () => {
    stubApi({ 'DELETE /api/v1/documents/d1': fail(500, 'Down!') });
    const onDeleted = jest.fn();
    render(
      <DeleteDocumentDialog
        document={DOC}
        open
        onOpenChange={() => undefined}
        onDeleted={onDeleted}
      />,
    );
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: /Delete/,
      }),
    );
    expect(await screen.findByText('Couldn’t delete it')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('edit', () => {
  const open = () => {
    const onOpenChange = jest.fn();
    render(
      <EditDocumentDialog document={DOC} open onOpenChange={onOpenChange} />,
    );
    return { onOpenChange, title: screen.getByLabelText('Title') };
  };

  it('needs a title', async () => {
    const calls = stubApi({});
    const { title } = open();
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('saves the trimmed title, and shows a refusal in place', async () => {
    const calls = stubApi({ 'PATCH /api/v1/documents/d1': ok({}) });
    const { onOpenChange, title } = open();
    await userEvent.clear(title);
    await userEvent.type(title, '  Remote Work.pdf ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls[0].body).toEqual({ title: 'Remote Work.pdf' });
  });

  it('shows a refusal in place', async () => {
    stubApi({
      'PATCH /api/v1/documents/d1': fail(409, 'That title is taken!'),
    });
    const { title } = open();
    await userEvent.type(title, ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/That title is taken/)).toBeInTheDocument();
  });
});
