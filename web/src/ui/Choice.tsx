import { useId, type ReactNode } from 'react';
import { DisabledReason } from './DisabledReason.tsx';

interface ChoiceContentProps {
  closed: boolean;
  /** A picture on the leading side, such as a medal or an orb. */
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  reason?: { id: string; text: string };
  /** Extra content under the text, such as a Starter picker. */
  children?: ReactNode;
}

/** Spans only, so the same panel is valid inside a button or a label. */
function ChoiceContent({ closed, art, title, description, reason, children }: ChoiceContentProps) {
  return (
    <span className="panel flex h-full flex-wrap items-start gap-4 p-5 sm:p-6" data-closed={closed}>
      {art !== undefined && <span className="shrink-0">{art}</span>}
      <span className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <span className="font-display text-xl leading-snug font-semibold sm:text-2xl">{title}</span>
        {description !== undefined && (
          <span className="text-base text-pretty text-ink-soft">{description}</span>
        )}
        {reason !== undefined && <DisabledReason id={reason.id}>{reason.text}</DisabledReason>}
        {children}
      </span>
    </span>
  );
}

interface ChoiceButtonProps {
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Set when the choice is unusable: it greys out and shows why (spec §3.1). */
  disabledReason?: string;
  onClick?: () => void;
}

/** A choice that acts at once, such as the only open mode. */
export function ChoiceButton({
  art,
  title,
  description,
  disabledReason,
  onClick,
}: ChoiceButtonProps) {
  const reasonId = useId();
  const closed = disabledReason !== undefined;
  return (
    <button
      type="button"
      className="choice"
      disabled={closed}
      aria-describedby={closed ? reasonId : undefined}
      onClick={onClick}
    >
      <ChoiceContent
        closed={closed}
        art={art}
        title={title}
        description={description}
        reason={closed ? { id: reasonId, text: disabledReason } : undefined}
      />
    </button>
  );
}

interface ChoiceRadioProps {
  name: string;
  value: string;
  checked: boolean;
  art?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  disabledReason?: string;
  onSelect: (value: string) => void;
}

/** One answer of a radio group that a Next button confirms, such as a class. */
export function ChoiceRadio({
  name,
  value,
  checked,
  art,
  title,
  description,
  disabledReason,
  onSelect,
}: ChoiceRadioProps) {
  const reasonId = useId();
  const closed = disabledReason !== undefined;
  return (
    <label className="choice" data-selected={checked}>
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={checked}
        disabled={closed}
        aria-describedby={closed ? reasonId : undefined}
        onChange={() => onSelect(value)}
      />
      <ChoiceContent
        closed={closed}
        art={art}
        title={title}
        description={description}
        reason={closed ? { id: reasonId, text: disabledReason } : undefined}
      />
    </label>
  );
}
