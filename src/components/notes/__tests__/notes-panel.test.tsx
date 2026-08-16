import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { addApplicationNote } from '@/app/actions/add-application-note';
import type { ApplicationNote } from '@/lib/applications/notes';
import { NotesPanel } from '../notes-panel';

jest.mock('@/app/actions/add-application-note', () => ({
  addApplicationNote: jest.fn(),
}));

const mockAddNote = addApplicationNote as jest.MockedFunction<typeof addApplicationNote>;
const originalMatchMedia = window.matchMedia;

const notes: ApplicationNote[] = [
  {
    id: 'note-1',
    applicationId: 'application-1',
    authorName: 'Avery Lead',
    body: 'Strong technical response.',
    createdAt: '2026-08-14T15:30:00.000Z',
  },
  {
    id: 'note-2',
    applicationId: 'application-1',
    authorName: 'Morgan Admin',
    body: 'Invite to the next interview.',
    createdAt: '2026-08-15T17:45:00.000Z',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
});

function openNotes(initialNotes: ApplicationNote[] = notes) {
  render(<NotesPanel applicationId="application-1" initialNotes={initialNotes} />);
  fireEvent.click(screen.getByRole('button', { name: /notes/i }));
  return screen.getByRole('dialog', { name: 'Application notes' });
}

it('opens from a visible count trigger and shows attributed history chronologically', () => {
  const panel = openNotes();

  expect(panel).not.toHaveAttribute('aria-modal');
  expect(screen.getByRole('button', { name: 'Notes, 2 notes' })).toBeInTheDocument();
  const items = within(panel).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Avery Lead'),
    expect.stringContaining('Morgan Admin'),
  ]);
  expect(items[0]).toHaveTextContent('14 Aug 2026, 15:30');
  expect(items[1]).toHaveTextContent('15 Aug 2026, 17:45');
});

it('omits a redundant popup header and close button', () => {
  const panel = openNotes();

  expect(within(panel).queryByRole('heading')).not.toBeInTheDocument();
  expect(within(panel).queryByRole('button', { name: 'Close notes' })).not.toBeInTheDocument();
  expect(within(panel).queryByText('New note', { selector: 'label' })).not.toBeInTheDocument();
  expect(within(panel).getByRole('textbox', { name: 'New note' })).toHaveAttribute(
    'placeholder',
    'New note',
  );
});

it('closes when a desktop user clicks outside the popup', () => {
  render(
    <>
      <button type="button">Application content</button>
      <NotesPanel applicationId="application-1" initialNotes={notes} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Notes, 2 notes' }));
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Application content' }));

  expect(screen.queryByRole('dialog', { name: 'Application notes' })).not.toBeInTheDocument();
});

it('contains focus and exposes modal semantics on narrow screens', () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({
      matches: true,
      media: '(max-width: 639px)',
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });

  render(
    <>
      <button type="button">Outside control</button>
      <NotesPanel applicationId="application-1" initialNotes={[]} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Notes, 0 notes' }));

  const dialog = screen.getByRole('dialog', { name: 'Application notes' });
  const composer = within(dialog).getByRole('textbox', { name: 'New note' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(composer).toHaveFocus();

  fireEvent.change(composer, { target: { value: 'Draft' } });
  const add = within(dialog).getByRole('button', { name: 'Add note' });
  add.focus();
  fireEvent.keyDown(add, { key: 'Tab' });
  expect(composer).toHaveFocus();

  fireEvent.keyDown(composer, { key: 'Tab', shiftKey: true });
  expect(add).toHaveFocus();

  screen.getByRole('button', { name: 'Outside control' }).focus();
  expect(composer).toHaveFocus();
});

it('appends a successful note, clears the composer, and increments the count', async () => {
  mockAddNote.mockResolvedValue({
    ok: true,
    note: {
      id: 'note-3',
      applicationId: 'application-1',
      authorName: 'Avery Lead',
      body: 'Follow up on availability.',
      createdAt: '2026-08-16T18:00:00.000Z',
    },
  });
  const panel = openNotes([]);
  const composer = within(panel).getByRole('textbox', { name: 'New note' });

  fireEvent.change(composer, { target: { value: '  Follow up on availability.  ' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));

  await waitFor(() =>
    expect(mockAddNote).toHaveBeenCalledWith('application-1', 'Follow up on availability.'),
  );
  expect(await within(panel).findByText('Follow up on availability.')).toBeInTheDocument();
  expect(composer).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Notes, 1 note' })).toBeInTheDocument();
});

it('shows a useful error and preserves the draft when submission fails', async () => {
  mockAddNote.mockResolvedValue({
    ok: false,
    error: 'Could not add this note. Try again.',
  });
  const panel = openNotes([]);
  const composer = within(panel).getByRole('textbox', { name: 'New note' });

  fireEvent.change(composer, { target: { value: 'Do not lose this draft' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));

  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    'Could not add this note. Try again.',
  );
  expect(composer).toHaveValue('Do not lose this draft');
});

it('preserves the draft when the server action rejects', async () => {
  mockAddNote.mockRejectedValue(new Error('network down'));
  const panel = openNotes([]);
  const composer = within(panel).getByRole('textbox', { name: 'New note' });

  fireEvent.change(composer, { target: { value: 'Retry after reconnecting' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));

  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    'Could not add this note. Try again.',
  );
  expect(composer).toHaveValue('Retry after reconnecting');
});

it('consumes the first Escape to close notes before an outer takeover sees it', () => {
  const takeoverEscape = jest.fn();
  document.addEventListener('keydown', takeoverEscape);
  openNotes();

  fireEvent.keyDown(document.body, { key: 'Escape' });

  expect(screen.queryByRole('dialog', { name: 'Application notes' })).not.toBeInTheDocument();
  expect(takeoverEscape).not.toHaveBeenCalled();

  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(takeoverEscape).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', takeoverEscape);
});

it('does not claim the global Cmd/Ctrl+K shortcut', () => {
  render(<NotesPanel applicationId="application-1" initialNotes={[]} />);

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

  expect(screen.queryByRole('dialog', { name: 'Application notes' })).not.toBeInTheDocument();
});
