import { render, screen, fireEvent } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Takeover } from '../takeover';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const showModal = jest.fn(function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
});

beforeAll(() => {
  // jsdom implements neither, so stand in for them closely enough that the
  // promotion below behaves as a browser's would, close event included.
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  replace.mockClear();
  showModal.mockClear();
});

function takeover() {
  return (
    <Takeover label="Ada Lovelace application" returnHref="/admin/software">
      Applicant detail
    </Takeover>
  );
}

/** The markup a browser paints before any effect has run. */
function firstPaint() {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(takeover());
  return host;
}

it('keeps the board visibly framing the application takeover', () => {
  render(takeover());

  const dialog = screen.getByRole('dialog', { name: 'Ada Lovelace application' });
  expect(dialog).toHaveClass('max-w-[1100px]', 'w-[92vw]', 'h-[88vh]');
  expect(dialog).not.toHaveClass('max-w-[1440px]', 'w-[94vw]', 'h-[90vh]');
});

it('paints the applicant already open, so no frame shows the bare board', () => {
  const dialog = firstPaint().querySelector('dialog');

  expect(dialog).not.toBeNull();
  expect(dialog).toHaveAttribute('open');
});

it('paints its own dimming, which a not-yet-modal dialog has no backdrop for', () => {
  const host = firstPaint();
  const dim = host.querySelector('[class~="bg-black/50"]');

  expect(dim).not.toBeNull();
  expect(dim?.closest('dialog')).toBeNull();
  // Otherwise the page darkens twice over once the dialog reaches the top layer.
  expect(host.querySelector('dialog')).not.toHaveClass('backdrop:bg-black/50');
});

it('promotes the painted dialog to a real modal once mounted', () => {
  render(takeover());

  expect(showModal).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog', { name: 'Ada Lovelace application' })).toHaveAttribute('open');
});

it('stays put while promoting, whose close step must not read as a dismissal', () => {
  render(takeover());

  expect(replace).not.toHaveBeenCalled();
});

it('returns to the board when Escape cancels the takeover', () => {
  render(takeover());

  fireEvent(
    screen.getByRole('dialog', { name: 'Ada Lovelace application' }),
    new Event('cancel', { bubbles: false, cancelable: true }),
  );

  expect(replace).toHaveBeenCalledWith('/admin/software');
});

it('returns to the board when the close button is pressed', () => {
  render(takeover());

  fireEvent.click(screen.getByRole('button', { name: 'Close application' }));

  expect(replace).toHaveBeenCalledWith('/admin/software');
});
