import { useEffect, useRef } from 'react';
import type { Observation } from '../../../engine/index.ts';
import type { PassNotice } from '../game/store.ts';
import type { Person } from '../game/people.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { Button } from '../ui/Button.tsx';
import './pass-screen.css';

interface PassScreenProps {
  pass: PassNotice;
  /** Everyone at the table: the others are asked to look away. */
  people: readonly Person[];
  /** The public game, for the one public fact an answer's reason names (whose turn it is). */
  game: Observation['public'] | null;
  onConfirm: () => void;
}

/** "Mai", "Mai and Kim", "Mai, Kim, and Joe". */
const listNames = (names: readonly string[]) =>
  new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);

/**
 * The hand-over (spec §3, §4.1): a full-screen sky with no board, no hand and nothing private on
 * it. It names who must take the device and, for an answer given during another player's turn,
 * the public reason ("Fisherman challenges you"). The one button is the only way on, and Enter
 * presses it. What it renders is the same whoever has the device: a seat index, names and a class.
 */
export function PassScreen({ pass, people, game, onConfirm }: PassScreenProps) {
  const screen = useRef<HTMLElement>(null);
  // Enter presses the one button, so it holds focus from the moment the screen appears.
  useEffect(() => screen.current?.querySelector('button')?.focus(), []);
  const name = people.find((person) => person.seatIndex === pass.seatIndex)?.name ?? '';
  const others = people.filter((person) => person.seatIndex !== pass.seatIndex).map((p) => p.name);
  // Only a public cause is named: a challenge is declared in the open, but whatever else asks a
  // person for an answer (a hostile item or Ability reaction) is private to the pair, so the
  // screen says nothing of it.
  const challenger =
    pass.kind === 'answer' && game?.phase.kind === 'pvp'
      ? game.players.find((player) => player.seatIndex === pass.fromSeatIndex)
      : undefined;
  const reason = challenger
    ? t('pass.reason.challenge', { who: className(challenger.classId) })
    : undefined;
  const heading = reason ? t('pass.headingAnswer', { name, reason }) : t('pass.heading', { name });
  return (
    <section
      ref={screen}
      className="pass-screen"
      aria-labelledby="pass-heading"
      data-pass-seat={pass.seatIndex}
    >
      <span className="seat-disc pass-disc" data-seat={pass.seatIndex} aria-hidden="true">
        {pass.seatIndex}
      </span>
      <h1 id="pass-heading" className="pass-heading">
        {heading}
      </h1>
      <p className="pass-look">
        {others.length > 0
          ? t('pass.look', { others: listNames(others), name })
          : t('pass.lookAlone', { name })}
      </p>
      <Button variant="primary" className="pass-button" onClick={onConfirm}>
        {t('pass.button', { name })}
      </Button>
    </section>
  );
}
