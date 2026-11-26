import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';

/**
 * The top bar's Game record (spec §3, Board screen; issue #256): the latest Event card, the field
 * log, table talk and the promises panel open together in one sheet instead of sitting under the
 * board, so the play screen fits without a page scroll and nothing shown before is out of reach.
 * Closing it (Close or Escape) returns focus to the button. The game is not held while it is open.
 */
export function GameRecord({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        className="top-button"
        aria-haspopup="dialog"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
      >
        {t('record.open')}
      </Button>
      {open && (
        <RecordSheet
          onClose={() => {
            setOpen(false);
            queueMicrotask(() => opener.current?.focus());
          }}
        >
          {children}
        </RecordSheet>
      )}
    </>
  );
}

function RecordSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="record-sheet"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="record-head">
        <h2 id={headingId}>{t('record.heading')}</h2>
        <Button variant="secondary" className="top-button" onClick={onClose}>
          {t('record.close')}
        </Button>
      </div>
      <div className="record-body">{children}</div>
    </dialog>
  );
}
