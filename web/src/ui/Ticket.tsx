import { useId, type ReactNode } from 'react';
import { DisabledReason } from './DisabledReason.tsx';

type Tone = 'plain' | 'selected' | 'disabled';

interface TicketProps {
  tone?: Tone;
  /** The tear-off end: holds the one number or key fact of the ticket. */
  stub?: ReactNode;
  children: ReactNode;
}

/** Spans only, so a ticket is valid inside a button or a label. */
export function Ticket({ tone = 'plain', stub, children }: TicketProps) {
  return (
    <span className="ticket" data-tone={tone}>
      <span className="ticket-body">{children}</span>
      {stub !== undefined && <span className="ticket-stub">{stub}</span>}
    </span>
  );
}

export function TicketTitle({ children }: { children: ReactNode }) {
  return <span className="block text-lg leading-snug font-bold text-current">{children}</span>;
}

export function TicketText({ children }: { children: ReactNode }) {
  return <span className="block text-base text-pretty text-ink-soft">{children}</span>;
}

interface TicketButtonProps {
  title: ReactNode;
  description?: ReactNode;
  stub?: ReactNode;
  /** Set when the choice is unusable: the ticket greys out and shows why (spec §3.1). */
  disabledReason?: string;
  onClick?: () => void;
}

/** A choice that acts at once, such as a mode. */
export function TicketButton({
  title,
  description,
  stub,
  disabledReason,
  onClick,
}: TicketButtonProps) {
  const reasonId = useId();
  return (
    <button
      type="button"
      className="ticket-control"
      disabled={disabledReason !== undefined}
      aria-describedby={disabledReason === undefined ? undefined : reasonId}
      onClick={onClick}
    >
      <Ticket tone={disabledReason === undefined ? 'plain' : 'disabled'} stub={stub}>
        <TicketTitle>{title}</TicketTitle>
        {description !== undefined && <TicketText>{description}</TicketText>}
        {disabledReason !== undefined && (
          <DisabledReason id={reasonId}>{disabledReason}</DisabledReason>
        )}
      </Ticket>
    </button>
  );
}

interface TicketRadioProps {
  name: string;
  value: string;
  checked: boolean;
  title: ReactNode;
  description?: ReactNode;
  stub?: ReactNode;
  disabledReason?: string;
  onSelect: (value: string) => void;
}

/** One option of a radio group whose answer is confirmed later, such as a difficulty. */
export function TicketRadio({
  name,
  value,
  checked,
  title,
  description,
  stub,
  disabledReason,
  onSelect,
}: TicketRadioProps) {
  const reasonId = useId();
  const disabled = disabledReason !== undefined;
  return (
    <label className="ticket-choice">
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-describedby={disabled ? reasonId : undefined}
        onChange={() => onSelect(value)}
      />
      <Ticket tone={disabled ? 'disabled' : checked ? 'selected' : 'plain'} stub={stub}>
        <TicketTitle>{title}</TicketTitle>
        {description !== undefined && <TicketText>{description}</TicketText>}
        {disabled && <DisabledReason id={reasonId}>{disabledReason}</DisabledReason>}
      </Ticket>
    </label>
  );
}
