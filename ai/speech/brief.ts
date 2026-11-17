import { effectiveForm } from '../../engine/index.ts';
import type { Content, SeatEvent, Observation } from '../../engine/index.ts';
import type { Personality } from '../../content/personality-schema.ts';
import type { Voice } from '../../content/voice-schema.ts';
import type { Situation } from '../lines.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../state/index.ts';

export const MAX_RECENT_EVENTS = 3;

export type Standing = 'leading' | 'level' | 'behind';
export type LapStage = 'first lap' | 'middle lap' | 'last lap' | 'final table round';

/**
 * What the speech writer may see (spec §4.1, §5.4): public facts only. Stricter than
 * `buildJevState` on purpose: no hand, Balls, peek results, chats, seed, deck order or digit,
 * so a line can never carry one seat's secret to another.
 */
export type SpeechBrief = {
  topic: { id: Situation; text: string };
  world: string;
  lap_stage: LapStage;
  speaker: {
    /** The class name: classes are unique per game and observations carry no other name. */
    name: string;
    class_hint: string;
    coins: Standing;
    personality: { name: string; text: string; line_style: string };
  };
  /** `null` speaks to the table. */
  addressed: { name: string; coins: Standing } | null;
  /**
   * A reply only (spec §5.7): what the addressed seat just said, as quoted data. It is a line that
   * already passed the output screen and the manipulation gate, never the other seat's setup.
   */
  reply_to?: { name: string; says: string };
  /** At most three, oldest first, as plain sentences without amounts. */
  recent_events: string[];
  /** Names of items every seat can see; the output screen allows these and no other item name. */
  public_items: string[];
};

export type SpeechBriefInput = {
  /** The speaking seat's own observation. */
  observation: Observation;
  /** Events from that seat's own feed (`eventsVisibleTo`), oldest first. */
  events: readonly SeatEvent[];
  situation: Situation;
  /** The addressed seat; omit to speak to the table. */
  addressedSeat?: number;
  /** What the addressed seat just said, for a reply: needs `addressedSeat`. */
  quote?: string;
  personality: Personality;
  content: Content;
  voice: Voice;
};

/** Words, never a number: leading is strictly most coins, level ties the best other seat. */
function standing(players: Observation['public']['players'], seat: number): Standing {
  const coins = players.find((player) => player.seatIndex === seat)!.coins;
  const best = Math.max(
    ...players.filter((player) => player.seatIndex !== seat).map((player) => player.coins),
  );
  return coins > best ? 'leading' : coins === best ? 'level' : 'behind';
}

function lapStage(observation: Observation): LapStage {
  const { players, lapTarget, finalTableRound } = observation.public;
  if (finalTableRound !== null) return 'final table round';
  const you = players.find((player) => player.seatIndex === observation.own.seatIndex)!;
  const lap = Math.min(you.creditedLap + 1, lapTarget);
  return lap >= lapTarget ? 'last lap' : lap === 1 ? 'first lap' : 'middle lap';
}

/** Only events that are public with their amounts left out; anything else is not told. */
function describeEvents(
  events: readonly SeatEvent[],
  observation: Observation,
  content: Content,
): string[] {
  const { players } = observation.public;
  const className = (id: string) => content.classes.find((entry) => entry.id === id)?.name;
  const owner = (actorId: string) => {
    const player = players.find((entry) => entry.actorId === actorId);
    return player && className(player.classId);
  };
  const form = (formId: string) => effectiveForm(content, formId).name;
  const held = (instanceId: string) =>
    players.flatMap((player) => player.team).find((pokemon) => pokemon.instanceId === instanceId);
  const sentences = events.map((event): string | undefined => {
    switch (event.kind) {
      case 'pokemon_evolved': {
        const who = owner(event.ownerId);
        return who && `${who} evolved ${form(event.fromFormId)} into ${form(event.toFormId)}.`;
      }
      case 'uid_created': {
        const pokemon = event.entity === 'pokemon' ? held(event.instanceId) : undefined;
        const who = owner(event.ownerId);
        return pokemon && who && `${who} gained a ${form(pokemon.speciesId)}.`;
      }
      case 'status_changed': {
        const pokemon = event.operation === 'cleared' ? undefined : held(event.instanceId);
        const who = owner(event.ownerId);
        return pokemon && who && `${who}'s ${form(pokemon.speciesId)} became tired.`;
      }
      case 'coin_transfer': {
        const to =
          event.destination.kind === 'bank' ? 'the bank' : owner(event.destination.actorId);
        const from = event.source.kind === 'bank' ? 'the bank' : owner(event.source.actorId);
        if (!to || !from) return undefined;
        if (event.reason === 'start_income') return `${to} passed Start and was paid.`;
        if (event.reason === 'pokemon_sale')
          return `${from === 'the bank' ? to : from} sold a creature.`;
        return `${to} received coins from ${from}.`;
      }
      case 'final_table_round':
        return 'The final table round began.';
      // Chats, hostile item use, item UIDs, shuffles and random results are not public: never told.
      default:
        return undefined;
    }
  });
  return sentences.filter((sentence) => sentence !== undefined).slice(-MAX_RECENT_EVENTS);
}

/** A digit anywhere in the brief means a number reached the writer (spec §5.4). */
function assertNoDigits(brief: SpeechBrief): void {
  if (/\p{N}/u.test(JSON.stringify(brief))) throw new TypeError('Speech brief contains a digit');
}

export function buildSpeechBrief(input: SpeechBriefInput): SpeechBrief {
  const { observation, events, situation, addressedSeat, quote, personality, content, voice } =
    input;
  const { players } = observation.public;
  const seat = observation.own.seatIndex;
  const you = players.find((player) => player.seatIndex === seat);
  if (!you) throw new RangeError('Observation has no player for its own seat');
  const nameOf = (classId: string) => {
    const name = content.classes.find((entry) => entry.id === classId)?.name;
    if (!name) throw new RangeError(`Unknown class "${classId}"`);
    return name;
  };
  const text = (map: Record<string, string>, kind: string, key: string) => {
    const value = Object.hasOwn(map, key) ? map[key] : undefined;
    if (!value) throw new RangeError(`The voice file has no ${kind} for "${key}"`);
    return value;
  };
  const addressed =
    addressedSeat === undefined ? undefined : players.find((p) => p.seatIndex === addressedSeat);
  if (addressedSeat !== undefined && (!addressed || addressedSeat === seat)) {
    throw new RangeError('Addressed seat must be another seat in the game');
  }
  if (quote !== undefined && !addressed) {
    throw new RangeError('A reply needs the seat it answers');
  }
  const brief: SpeechBrief = {
    topic: { id: situation, text: text(voice.topics, 'topic', situation) },
    world: voice.world,
    lap_stage: lapStage(observation),
    speaker: {
      name: nameOf(you.classId),
      class_hint: text(voice.classHints, 'class hint', you.classId),
      coins: standing(players, seat),
      personality: {
        name: personality.name,
        text: personality.description,
        line_style: personality.lineStyle,
      },
    },
    addressed: addressed
      ? { name: nameOf(addressed.classId), coins: standing(players, addressed.seatIndex) }
      : null,
    ...(quote !== undefined && { reply_to: { name: nameOf(addressed!.classId), says: quote } }),
    recent_events: describeEvents(events, observation, content),
    public_items: [
      ...new Set(players.flatMap((player) => player.knownItems.map((item) => item.name))),
    ].sort(),
  };
  assertNoComparableNumbers(brief);
  assertNoDigits(brief);
  assertStateTokenBudget(brief);
  return brief;
}
