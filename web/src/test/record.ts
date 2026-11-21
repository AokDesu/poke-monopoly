import { act, fireEvent, screen } from '@testing-library/react';
import { t } from '../i18n/en.ts';

/** jsdom has no modal dialogs: open and close only set `open`, as the tests of dialogs do. */
function modalDialogs() {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
}

/**
 * Opens the play screen's Game record from the top bar, as a player does, and returns its sheet:
 * the latest Event card, the field log, table talk and the promises panel. Already open, it stays.
 */
export function openRecord(): HTMLElement {
  modalDialogs();
  const open = document.querySelector<HTMLElement>('dialog.record-sheet');
  if (open) return open;
  act(() => void fireEvent.click(screen.getByRole('button', { name: t('record.open') })));
  return screen.getByRole('dialog', { name: t('record.heading') });
}
