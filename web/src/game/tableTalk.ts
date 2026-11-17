import type { AiStatus } from '../../../engine/contract/decision.ts';
import type { AiSpeechEvent, Observation } from '../../../engine/index.ts';
import { en, t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { AI_DECISION_MS } from './ai.ts';
import { content } from './content.ts';
import type { SeatFeedEntry, SeatView, SpectatorView } from './store.ts';

/**
 * Presentation numbers for table talk, not game rules (spec §5.7, like `AI_DECISION_MS`): they
 * decide how often a comment may appear on screen and never touch a coin, die or legal action.
 */
export const TABLE_TALK = {
  /** One comment per round: one turn for every seat. */
  maxPerRound: 1,
  maxPerGame: 10,
  /** How long a requested line may take before it is dropped, never retried (same window as a decision). */
  deadlineMs: AI_DECISION_MS,
  /** A sale at least this large, in coins, is a "big sale": a little under a rare species' base price. */
  bigSaleCoins: 16,
  /** Comments are asked for only at these speeds. */
  speeds: ['normal'],
  /**
   * Bank lines are written for the seat that acted ("Sold {pokemon}", "I won at the Gym"). Another
   * seat saying one would claim something it did not do, so only a line about the table is allowed.
   */
  bankSituations: ['taunt_leader'],
} as const;

export type TalkSituation = 'catch_success' | 'sold_pokemon' | 'gym_win' | 'taunt_leader';
export type TalkSpeed = 'normal' | 'fast' | 'instant';
export type PublicGame = Observation['public'];

/** A public moment worth a comment, read from the viewer's own feed. */
export interface Moment {
  readonly situation: TalkSituation;
  /** The seat whose own action is being resolved: it never speaks about itself. */
  readonly actingSeat: number;
  /** The seat the moment is about: also never the speaker. */
  readonly subjectSeat: number;
  /** Who the line is addressed to (the subject, or the leader for a lead taunt). */
  readonly addressedSeat: number;
  /** The turn the moment happened in. */
  readonly turn: number;
}

/** The one seat with strictly the most coins, or null on a tie. Public information only. */
export function leaderOf(players: PublicGame['players']): number | null {
  const best = Math.max(...players.map((player) => player.coins));
  const top = players.filter((player) => player.coins === best);
  return top.length === 1 ? top[0]!.seatIndex : null;
}

/**
 * The moment the viewer's latest feed entry makes, if any. `previousLeader` is who led before it.
 * Reads only the viewer's feed and the public game, so a seat's hand can never start a comment.
 */
export function detectMoment(
  entry: SeatFeedEntry,
  game: PublicGame,
  previousLeader: number | null,
): Moment | null {
  const seatOf = (actorId: string) =>
    game.players.find((player) => player.actorId === actorId)?.seatIndex;
  const turn = entry.before.globalTurnNo;
  const { events, action } = entry.record;
  const acting = entry.before.activeSeatIndex;
  const leader = leaderOf(game.players);

  for (const event of events) {
    if (event.kind !== 'battle_reward_resolved' || event.source.kind !== 'gym') continue;
    const winner = seatOf(event.winnerId);
    if (winner !== undefined)
      return {
        situation: 'gym_win',
        actingSeat: acting,
        subjectSeat: winner,
        addressedSeat: winner,
        turn,
      };
  }
  if (action.kind === 'catch') {
    for (const event of events) {
      if (event.kind !== 'uid_created' || event.entity !== 'pokemon') continue;
      const owner = game.players.find((player) => player.actorId === event.ownerId);
      const species = owner?.team.find((member) => member.instanceId === event.instanceId);
      const rarity = content.species.find((entry) => entry.id === species?.speciesId)?.rarity;
      if (owner && rarity === 'rare')
        return {
          situation: 'catch_success',
          actingSeat: acting,
          subjectSeat: owner.seatIndex,
          addressedSeat: owner.seatIndex,
          turn,
        };
    }
  }
  if (action.kind === 'sell') {
    const sold = events.reduce(
      (sum, event) =>
        event.kind === 'coin_transfer' && event.reason === 'pokemon_sale'
          ? sum + event.amount
          : sum,
      0,
    );
    if (sold >= TABLE_TALK.bigSaleCoins)
      return {
        situation: 'sold_pokemon',
        actingSeat: acting,
        subjectSeat: acting,
        addressedSeat: acting,
        turn,
      };
  }
  if (leader !== null && previousLeader !== null && leader !== previousLeader)
    return {
      situation: 'taunt_leader',
      actingSeat: acting,
      subjectSeat: acting,
      addressedSeat: leader,
      turn,
    };
  if (leader !== null && events.some((event) => event.kind === 'final_table_round'))
    return {
      situation: 'taunt_leader',
      actingSeat: acting,
      subjectSeat: acting,
      addressedSeat: leader,
      turn,
    };
  return null;
}

export const speedAllowsTalk = (speed: TalkSpeed): boolean =>
  (TABLE_TALK.speeds as readonly string[]).includes(speed);

/** One turn for every seat, counted from the first turn. */
export const roundOf = (turn: number, seats: number): number =>
  Math.floor(Math.max(0, turn - 1) / seats);

/** FNV-1a: a fixed hash, so a seed and a moment always choose the same speaker. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return value;
}

export interface TalkContext {
  readonly view: SeatView | SpectatorView;
  readonly seed: string | number;
  /** Which feed entry this is: part of the speaker's seed. */
  readonly momentKey: number;
  /** Lines already shown, from the saved log: the limits hold across a reload. */
  readonly spoken: readonly AiSpeechEvent[];
  readonly moment: Moment;
  readonly speed: TalkSpeed;
  readonly paused: boolean;
  readonly hidden: boolean;
}

export interface TalkPlan {
  readonly moment: Moment;
  readonly speakerSeat: number;
  readonly personalityId: string;
}

/**
 * Whether a comment may be asked for now, and from whom. Never at Fast or Instant, while paused or
 * hidden, past the round or game limit, or after the game ends; never from the seat whose own
 * moment it is; the speaker is a fixed function of the seed and the moment, among the AI seats.
 */
export function planTableTalk(context: TalkContext): TalkPlan | null {
  const { view, seed, momentKey, spoken, moment, speed, paused, hidden } = context;
  const game = view.observation.public;
  if (!speedAllowsTalk(speed) || paused || hidden) return null;
  if (game.phase.kind === 'finished') return null;
  if (spoken.length >= TABLE_TALK.maxPerGame) return null;
  const round = roundOf(moment.turn, game.players.length);
  const inRound = spoken.filter(
    (line) => roundOf(line.globalTurnNo, game.players.length) === round,
  ).length;
  if (inRound >= TABLE_TALK.maxPerRound) return null;
  const eligible = view.opponents
    .filter(
      (opponent) =>
        game.players.some((player) => player.seatIndex === opponent.seatIndex) &&
        opponent.seatIndex !== moment.actingSeat &&
        opponent.seatIndex !== moment.subjectSeat &&
        opponent.seatIndex !== moment.addressedSeat,
    )
    .toSorted((a, b) => a.seatIndex - b.seatIndex);
  if (eligible.length === 0) return null;
  const speaker = eligible[hash(`${seed}:table-talk:${momentKey}`) % eligible.length]!;
  return { moment, speakerSeat: speaker.seatIndex, personalityId: speaker.personality };
}

/** The saved table talk of a game, oldest first. */
export function spokenLines(
  dialogueEvents: readonly { kind: string }[] | undefined,
): AiSpeechEvent[] {
  return (dialogueEvents ?? []).filter(
    (event): event is AiSpeechEvent => event.kind === 'ai_speech',
  );
}

/**
 * `POST /api/ai/speak`'s body. The route wants the speaker's own observation, but a line must not
 * be able to carry a hand, a Ball count or a peek result, so `own` is sent empty: the writer gets
 * the public game the viewer sees and the speaker's seat number, nothing private (spec §4.1, §5.4).
 */
export function speakBody(args: {
  gameId: string;
  plan: TalkPlan;
  game: PublicGame;
  momentKey: number;
}): unknown {
  const { gameId, plan, game, momentKey } = args;
  return {
    gameId,
    seatIndex: plan.speakerSeat,
    stateRevision: game.stateRevision,
    observation: {
      public: game,
      own: {
        seatIndex: plan.speakerSeat,
        items: [],
        balls: { poke: 0, great: 0, ultra: 0 },
        privateResults: [],
      },
    },
    situation: plan.moment.situation,
    addressedSeat: plan.moment.addressedSeat,
    personalityId: plan.personalityId,
    turnKey: `talk:${momentKey}`,
  };
}

export interface SpokenAnswer {
  readonly source: 'haiku' | 'bank';
  readonly text: string;
  readonly lineId?: string;
}

/**
 * Asks the speech route for one line. Same deadline rules as an AI decision: a line that is not
 * here within `TABLE_TALK.deadlineMs` is dropped even if it arrives later, and nothing is retried.
 * Every failure, and a reply with no line, is `null`; the game never waits for this.
 */
export async function requestSpeech(
  body: unknown,
  signal: AbortSignal,
): Promise<SpokenAnswer | null> {
  if (signal.aborted) return null;
  const controller = new AbortController();
  const { promise, resolve } = Promise.withResolvers<SpokenAnswer | null>();
  const abort = () => resolve(null);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, TABLE_TALK.deadlineMs);
  void (async () => {
    const response = await fetch('/api/ai/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('source' in value)) return null;
    if (value.source === 'haiku' && 'text' in value && typeof value.text === 'string')
      return { source: 'haiku' as const, text: value.text };
    if (
      value.source === 'bank' &&
      'lineId' in value &&
      typeof value.lineId === 'string' &&
      'text' in value &&
      typeof value.text === 'string'
    )
      return { source: 'bank' as const, text: value.text, lineId: value.lineId };
    return null;
  })().then(resolve, () => resolve(null));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', abort);
  }
}

/**
 * The `ai_speech` event for an answer, or null when nothing may be shown: a bank line only for a
 * situation the table can say, with the engine's own class name in its slot and no slot left over.
 */
export function speechEvent(
  plan: TalkPlan,
  answer: SpokenAnswer,
  game: PublicGame,
): AiSpeechEvent | null {
  const { moment, speakerSeat } = plan;
  const base = {
    kind: 'ai_speech' as const,
    speakerSeatIndex: speakerSeat,
    addressedSeatIndex: moment.addressedSeat,
    globalTurnNo: moment.turn,
  };
  if (answer.source === 'haiku') {
    const text = answer.text.trim();
    return text.length > 0 && text.length <= 280 ? { ...base, source: 'haiku', text } : null;
  }
  const key = `ai.line.${answer.lineId}` as const;
  const addressed = game.players.find((player) => player.seatIndex === moment.addressedSeat);
  if (!canSpeakWithoutHaiku(moment.situation) || !Object.hasOwn(en, key) || !addressed) return null;
  const text = t(key, { target: className(addressed.classId) });
  return /[{}]/.test(text) ? null : { ...base, source: 'bank', lineId: answer.lineId!, text };
}

export type VoiceReason = 'disabled' | 'missing_key' | 'budget_exceeded';

/**
 * Why generated speech is off, from `GET /api/ai/status`: only a reason the server gave (spec §3,
 * §9). An unreachable or older status says nothing, so no badge is shown for it.
 */
export function voiceOff(status: Pick<AiStatus, 'speech'> | null): VoiceReason | null {
  const speech = status?.speech;
  if (speech?.enabled !== false) return null;
  return speech.reason;
}

/** With generated speech off only a bank line can come back, so a situation with none is not asked for. */
export const canSpeakWithoutHaiku = (situation: TalkSituation): boolean =>
  (TABLE_TALK.bankSituations as readonly string[]).includes(situation);
