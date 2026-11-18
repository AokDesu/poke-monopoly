import type { BattleChoicePreview, BattlePreview } from '../../../engine/index.ts';
import { currentForm } from '../game/content.ts';
import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import { seatLabel } from './labels.ts';

type Terms = Pick<BattlePreview | BattleChoicePreview, 'kind' | 'snapshot' | 'odds'>;

/** One side's chances as percentages from one seat's reading; the engine rounds each separately. */
export interface Chances {
  /** The seat these chances belong to. */
  readonly seatIndex: number;
  readonly win: number;
  /** Absent at a Gym, where a total equal to the DC wins (§4.4). */
  readonly tie?: number;
  readonly lose?: number;
}

/**
 * The engine's odds are the challenger's (PvP attacker, Gym challenger). A defender reads them
 * swapped, so "win" always means the seat the screen speaks to; a seat outside the battle reads
 * the attacker's.
 */
export function chancesFor(terms: Terms, viewerSeat: number): Chances {
  const { odds, snapshot } = terms;
  if (snapshot.kind === 'gym') {
    return { seatIndex: snapshot.challenger.seatIndex, win: odds.win.percent };
  }
  const swapped = snapshot.defender.seatIndex === viewerSeat;
  return {
    seatIndex: swapped ? snapshot.defender.seatIndex : snapshot.attacker.seatIndex,
    win: (swapped ? odds.loss : odds.win).percent,
    tie: odds.tie.percent,
    lose: (swapped ? odds.win : odds.loss).percent,
  };
}

/** The pending battle's step in plain words, naming what its decider is doing. */
const WAITING_STEP = {
  response: 'battle.step.response',
  attacker_window: 'battle.step.window',
  defender_window: 'battle.step.window',
  window: 'battle.step.window',
  entry: 'battle.step.entry',
  reroll: 'battle.step.reroll',
  reward: 'battle.step.reward',
} as const;

/** Heading and body for the turn panel while a PvP or Gym battle is pending, or null otherwise. */
export function battleCopy(view: SeatView): { heading: string; body: string } | null {
  const { phase } = view.observation.public;
  if (phase.kind !== 'pvp' && phase.kind !== 'gym') return null;
  const you = view.seatIndex;
  const { battle } = phase;
  const decider = view.decision?.seatIndex;
  const name = (seat: number) => seatLabel(seat, you);
  if (phase.kind === 'pvp' && phase.battle.step === 'response' && decider === you) {
    return {
      heading: t('battle.heading.response'),
      body: t('battle.body.response', { name: name(phase.battle.attackerSeatIndex) }),
    };
  }
  if (decider === you) {
    const kind = phase.kind;
    switch (battle.step) {
      case 'entry':
        return { heading: t('battle.heading.gym'), body: t('battle.body.entry') };
      case 'window':
      case 'attacker_window':
      case 'defender_window':
        return { heading: t('battle.heading.window'), body: t('battle.body.window') };
      case 'reroll':
        return { heading: t('battle.heading.reroll'), body: t('battle.body.reroll') };
      case 'reward':
        return {
          heading: t('battle.heading.reward'),
          body: t(kind === 'gym' ? 'battle.body.rewardGym' : 'battle.body.rewardPvp'),
        };
    }
  }
  const step =
    battle.step in WAITING_STEP ? WAITING_STEP[battle.step as keyof typeof WAITING_STEP] : null;
  const heading = t(
    phase.kind === 'gym' || phase.battle.attackerSeatIndex === you
      ? 'battle.heading.yours'
      : 'battle.heading.watching',
  );
  return {
    heading:
      phase.kind === 'gym' && phase.battle.step !== 'entry' ? t('battle.heading.gym') : heading,
    body:
      step && decider !== undefined
        ? t('battle.waiting', { name: name(decider), step: t(step) })
        : t('battle.body.rolling'),
  };
}

/**
 * Who started a forced battle, from the records this seat may see: Rival's once-per-Lap challenge
 * is public, a Battle Ticket and an Ability name themselves to the target, and a third seat learns
 * only that the battle was forced (spec §4.1, Appendix C.3).
 */
export function forcedSource(view: SeatView): string {
  const opened = view.feed.findLast(({ record }) =>
    record.events.some((event) => event.kind === 'phase_changed' && event.to === 'pvp'),
  );
  if (!opened) return t('battle.forced.unknown');
  const name = seatLabel(opened.before.activeSeatIndex, view.seatIndex);
  const { action, events } = opened.record;
  if (action.kind === 'declare_pvp' && action.payload.force === 'rival') {
    return t('battle.forced.rival', { name });
  }
  const used = events.find((event) => event.kind === 'hostile_item_used');
  if (used?.kind === 'hostile_item_used') {
    return t('battle.forced.item', { name, item: itemName(used.itemId) });
  }
  const activated = events.find((event) => event.kind === 'ability_activated');
  if (activated?.kind === 'ability_activated') {
    const member = view.observation.public.players
      .flatMap((player) => player.team)
      .find((entry) => entry.instanceId === activated.instanceId);
    const ability = member && currentForm(member.speciesId).ability?.name;
    return ability ? t('battle.forced.ability', { name, ability }) : t('battle.forced.unknown');
  }
  return t('battle.forced.unknown');
}
