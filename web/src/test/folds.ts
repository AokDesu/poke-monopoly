import { act, fireEvent } from '@testing-library/react';

/**
 * Opens every folded line of greyed-out options on the page ("2 items can't be used now"), the way
 * a player reads the reasons, so a test can reach each greyed control and the engine's reason.
 */
export function openFolds(root: ParentNode = document): void {
  for (const toggle of root.querySelectorAll<HTMLElement>(
    '.folded-toggle[aria-expanded="false"]',
  )) {
    act(() => void fireEvent.click(toggle));
  }
}
