import type { AiStatus } from '../../../engine/contract/decision.ts';
import type { AiSpeechEvent, Observation } from '../../../engine/index.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { className, speciesName } from '../i18n/names.ts';
import type { SeatFeedEntry, SeatView, SpectatorView } from './store.ts';

/**
 * Presentation numbers for table talk, not game rules (spec §5.7, like `AI_DECISION_MS`): they
 * decide how often a comment may appear on screen and never touch a coin, die or legal action.
 */
export const TABLE_TALK = {
  /** Comments and exchanges per round (one turn for every seat): one is guaranteed, the rest answer a moment. */
  maxPerRound: 3,
  /** AI-to-AI exchanges per round: an AI speaks to another and the other answers once. */
  maxExchangesPerRound: 1,
  /**
   * How long the browser waits for a line, or for a whole exchange (the opening line, the server's
   * manipulation check and the answer together). A line takes Haiku up to 3,000 ms on the route,
   * which then answers from the line bank; this adds the trip. Past it the browser takes a bank
   * line itself, so a line always comes, never later than about 3.5 s, and nothing waits for it.
   */
  deadlineMs: 3_500,
  /** A sale at least this large, in coins, is a "big sale": a little under a rare species' base price. */
  bigSaleCoins: 16,
  /** A die face this high is a big roll, this low a bad one: the die's own ends, never a rule. */
  highRoll: 6,
  lowRoll: 1,
  /** Comments are asked for only at these speeds. */
  speeds: ['normal'],
} as const;

export type TalkSituation =
  | 'game_start'
  | 'table_banter'
  | 'table_retort'
  | 'taunt_leader'
  | 'catch_success'
  | 'catch_fail'
  | 'sold_pokemon'
  | 'gym_win'
  | 'roll_high_own'
  | 'roll_low_own'
  | 'battle_won_own'
  | 'battle_lost_own'
  | 'coins_in_own'
  | 'coins_out_own'
  | 'catch_other'
  | 'miss_other'
  | 'roll_high_other'
  | 'roll_low_other'
  | 'battle_won_other'
  | 'battle_lost_other'
  | 'coins_other'
  | 'sale_other'
  | 'gym_win_other';
export type TalkSpeed = 'normal' | 'fast' | 'instant';
export type PublicGame = Observation['public'];

/**
 * What happened, read from the viewer's own feed, or the two moments that are not in the feed: the
 * start of the game and a round that has had no line yet.
 */
export type MomentKind =
  | 'greeting'
  | 'banter'
  | 'lead'
  | 'roll_high'
  | 'roll_low'
  | 'catch'
  | 'miss'
  | 'sale'
  | 'gym_win'
  | 'battle_win'
  | 'battle_loss'
  | 'coins';

export interface Moment {
  readonly kind: MomentKind;
  /** The seat whose own action is being resolved. */
  readonly actingSeat: number;
  /**
   * The seat the moment is about: who rolled, caught, sold or lost, the winner of a battle, or the
   * seat that was paid.
   */
  readonly subjectSeat: number;
  /** The other seat of a battle (its loser) or of a payment (its payer). */
  readonly counterSeat: number | null;
  /** A lead taunt only: the leader it is addressed to. */
  readonly addressedSeat: number | null;
  /** The turn the moment happened in. */
  readonly turn: number;
  /** Public facts a bank line may name: the species' name and a sale's coins. */
  readonly pokemon?: string;
  readonly coins?: number;
}

/** The steps no seat outside the pair may know happened (§4.8): a chat, a promise and a Deal Card. */
const PRIVATE_STEPS: ReadonlySet<string> = new Set([
  'chat',
  'offer_promise',
  'respond',
  'propose_deal',
  'respond_deal',
  'counter_deal',
  'confirm_deal',
  'cancel_deal',
]);

/**
 * The feed as a bystander would hold it: without the steps that are private to a pair. Table talk is a shared
 * moment, so what triggers it and the key that names it come from these entries only; otherwise a seat outside
 * the pair would be asked to speak because of a proposal it never saw, or a key would differ with who watched.
 */
export const sharedFeed = (feed: readonly SeatFeedEntry[]): readonly SeatFeedEntry[] =>
  feed.filter((entry) => !PRIVATE_STEPS.has(entry.record.action.kind));

/** The one seat with strictly the most coins, or null on a tie. Public information only. */
export function leaderOf(players: PublicGame['players']): number | null {
  const best = Math.max(...players.map((player) => player.coins));
  const top = players.filter((player) => player.coins === best);
  return top.length === 1 ? top[0]!.seatIndex : null;
}

/**
 * The moment the viewer's latest feed entry makes, if any. `previousLeader` is who led just before it (the entry's own `before.leader`, so a private step between two renders is not charged to it),
 * `previous` the public game before it. Reads only the viewer's feed and the public game, so a
 * seat's hand can never start a comment. One moment per entry, the most newsworthy first: a Gym
 * win, a battle, coins changing hands, a catch, a sale, a change at the top, then a die.
 */
export function detectMoment(
  entry: SeatFeedEntry,
  game: PublicGame,
  previousLeader: number | null,
  previous: PublicGame | null = null,
): Moment | null {
  const seatOf = (actorId: string) =>
    game.players.find((player) => player.actorId === actorId)?.seatIndex;
  const turn = entry.before.globalTurnNo;
  const { events, action } = entry.record;
  const { phase } = entry.before;
  const acting = entry.before.activeSeatIndex;
  const leader = leaderOf(game.players);
  const moment = (
    kind: MomentKind,
    subjectSeat: number,
    more: Partial<Pick<Moment, 'counterSeat' | 'addressedSeat' | 'pokemon' | 'coins'>> = {},
  ): Moment => ({
    kind,
    actingSeat: acting,
    subjectSeat,
    counterSeat: null,
    addressedSeat: null,
    turn,
    ...more,
  });

  // A Deal Card is its two parties' alone (§4.8): a step that carries its payment makes no table news at all, not
  // the payment, not a change at the top its coins caused, not a die, so no seat is asked to speak about it.
  if (events.some((event) => event.kind === 'coin_transfer' && event.reason === 'deal'))
    return null;
  for (const event of events) {
    if (event.kind !== 'battle_reward_resolved' || event.source.kind !== 'gym') continue;
    const winner = seatOf(event.winnerId);
    if (winner !== undefined) return moment('gym_win', winner);
  }
  for (const event of events) {
    // A battle between players: the attacker's total decides it; a draw is not a moment.
    if (event.kind === 'pvp_resolved' && phase.kind === 'pvp' && event.outcome !== 'tie') {
      const { attackerSeatIndex, defenderSeatIndex } = phase.battle;
      const attackerWon = event.outcome === 'win';
      return moment('battle_win', attackerWon ? attackerSeatIndex : defenderSeatIndex, {
        counterSeat: attackerWon ? defenderSeatIndex : attackerSeatIndex,
      });
    }
    if (event.kind === 'gym_resolved' && event.outcome === 'loss')
      return moment('battle_loss', acting);
  }
  for (const event of events) {
    if (event.kind !== 'coin_transfer' || event.amount <= 0) continue;
    if (event.source.kind !== 'player' || event.destination.kind !== 'player') continue;
    const payer = seatOf(event.source.actorId);
    const paid = seatOf(event.destination.actorId);
    if (payer !== undefined && paid !== undefined)
      return moment('coins', paid, { counterSeat: payer });
  }
  // A catch is the engine's own die result with a `catch:` purpose, not the player's `catch` command.
  const catchRoll = events.some(
    (event) => event.kind === 'random_result' && event.purpose.startsWith('catch:'),
  );
  if (action.kind === 'dice_result' && catchRoll) {
    for (const event of events) {
      if (event.kind !== 'uid_created' || event.entity !== 'pokemon') continue;
      const owner = game.players.find((player) => player.actorId === event.ownerId);
      const species = owner?.team.find((member) => member.instanceId === event.instanceId);
      if (owner && species)
        return moment('catch', owner.seatIndex, { pokemon: speciesName(species.speciesId) });
    }
    // The die decided against the catch: the encounter ends and the creature is gone.
    if (phase.kind === 'encounter' && events.some((event) => event.kind === 'phase_changed'))
      return moment('miss', acting, { pokemon: speciesName(phase.pokemon.speciesId) });
  }
  if (action.kind === 'sell') {
    let total = 0;
    let largest: { coins: number; instanceId: string | undefined } | undefined;
    for (const [index, event] of events.entries()) {
      if (event.kind !== 'coin_transfer' || event.reason !== 'pokemon_sale') continue;
      total += event.amount;
      const next = events[index + 1];
      if (!largest || event.amount > largest.coins)
        largest = {
          coins: event.amount,
          instanceId: next?.kind === 'uid_destroyed' ? next.instanceId : undefined,
        };
    }
    const sold = previous?.players
      .find((player) => player.seatIndex === acting)
      ?.team.find((member) => member.instanceId === largest?.instanceId);
    if (total >= TABLE_TALK.bigSaleCoins && largest && sold)
      return moment('sale', acting, {
        pokemon: speciesName(sold.speciesId),
        coins: largest.coins,
      });
  }
  if (leader !== null && previousLeader !== null && leader !== previousLeader)
    return moment('lead', acting, { addressedSeat: leader });
  if (leader !== null && events.some((event) => event.kind === 'final_table_round'))
    return moment('lead', acting, { addressedSeat: leader });
  if (action.kind === 'dice_result') {
    for (const event of events) {
      if (event.kind !== 'random_result') continue;
      const roll = /^move:(\d+):/.exec(event.purpose);
      if (!roll) continue;
      const seat = Number(roll[1]);
      if (event.result === TABLE_TALK.highRoll) return moment('roll_high', seat);
      if (event.result === TABLE_TALK.lowRoll) return moment('roll_low', seat);
    }
  }
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

/** The moment that opens a game: the greeting before the first turn. */
export const greeting = (game: PublicGame): Moment => ({
  kind: 'greeting',
  actingSeat: game.activeSeatIndex,
  subjectSeat: game.activeSeatIndex,
  counterSeat: null,
  addressedSeat: null,
  turn: 0,
});

/**
 * The moment that keeps a round from being silent: the last turn of a round with no line in it.
 * Any step of that turn may open it, so a line that was dropped is asked for again on the next step.
 */
export function banterDue(game: PublicGame, spoken: readonly AiSpeechEvent[]): Moment | null {
  const seats = game.players.length;
  const turn = game.globalTurnNo;
  if (turn < 1 || turn % seats !== 0 || game.phase.kind === 'finished') return null;
  const round = roundOf(turn, seats);
  if (spoken.some((line) => roundOf(line.globalTurnNo, seats) === round)) return null;
  return {
    kind: 'banter',
    actingSeat: game.activeSeatIndex,
    subjectSeat: game.activeSeatIndex,
    counterSeat: null,
    addressedSeat: null,
    turn,
  };
}

/** The situation a seat speaks about a moment, and who it speaks to (`null`: the plan chooses). */
export function voiceFor(
  moment: Moment,
  speaker: number,
): { situation: TalkSituation; addressedSeat: number | null } {
  const { subjectSeat, counterSeat } = moment;
  const own = speaker === subjectSeat;
  const about = (situation: TalkSituation) => ({ situation, addressedSeat: null });
  const aboutSubject = (situation: TalkSituation) => ({ situation, addressedSeat: subjectSeat });
  // Speaking about itself an AI addresses the table; speaking about another seat, that seat.
  const either = (ownSituation: TalkSituation, otherSituation: TalkSituation) =>
    own ? about(ownSituation) : aboutSubject(otherSituation);
  switch (moment.kind) {
    case 'greeting':
      return about('game_start');
    case 'banter':
      return about('table_banter');
    case 'lead':
      return { situation: 'taunt_leader', addressedSeat: moment.addressedSeat };
    case 'roll_high':
      return either('roll_high_own', 'roll_high_other');
    case 'roll_low':
      return either('roll_low_own', 'roll_low_other');
    case 'catch':
      return either('catch_success', 'catch_other');
    case 'miss':
      return either('catch_fail', 'miss_other');
    case 'sale':
      return either('sold_pokemon', 'sale_other');
    case 'gym_win':
      return either('gym_win', 'gym_win_other');
    case 'battle_win':
      return own
        ? about('battle_won_own')
        : speaker === counterSeat
          ? about('battle_lost_own')
          : aboutSubject('battle_won_other');
    case 'battle_loss':
      return either('battle_lost_own', 'battle_lost_other');
    case 'coins':
      return own
        ? about('coins_in_own')
        : speaker === counterSeat
          ? about('coins_out_own')
          : aboutSubject('coins_other');
  }
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

/** The AI that answers the opening line: the seat it is addressed to, when that is an AI. */
export interface ExchangeListener {
  readonly seat: number;
  readonly personalityId: string;
}

export interface TalkPlan {
  readonly moment: Moment;
  readonly speakerSeat: number;
  readonly personalityId: string;
  readonly situation: TalkSituation;
  /** The seat the line is spoken to; a bank line that names no one is shown to the table. */
  readonly addressedSeat: number;
  /** Set when the addressed seat is an AI that may answer once (spec §5.7). */
  readonly listener: ExchangeListener | null;
}

/**
 * Whether a comment may be asked for now, and from whom. Never at Fast or Instant, while paused or
 * hidden, past the round's limit or after the game ends. Any AI seat may speak, about its own turn
 * or another seat's; a lead taunt is never from the seat that took the lead or the leader. The
 * speaker and whom it speaks to are fixed by the seed and the moment. The limits are counted from
 * the saved lines.
 */
export function planTableTalk(context: TalkContext): TalkPlan | null {
  const { view, seed, momentKey, spoken, moment, speed, paused, hidden } = context;
  const game = view.observation.public;
  if (!speedAllowsTalk(speed) || paused || hidden) return null;
  if (game.phase.kind === 'finished') return null;
  const seats = game.players.length;
  const round = roundOf(moment.turn, seats);
  const inRound = talkEntries(spoken.filter((line) => roundOf(line.globalTurnNo, seats) === round));
  if (inRound.length >= TABLE_TALK.maxPerRound) return null;
  const seatIn = (seat: number) => game.players.some((player) => player.seatIndex === seat);
  const eligible = view.opponents
    .filter(
      (opponent) =>
        seatIn(opponent.seatIndex) &&
        (moment.kind !== 'lead' ||
          (opponent.seatIndex !== moment.actingSeat &&
            opponent.seatIndex !== moment.addressedSeat)),
    )
    .toSorted((a, b) => a.seatIndex - b.seatIndex);
  if (eligible.length === 0) return null;
  const speaker = eligible[hash(`${seed}:table-talk:${momentKey}`) % eligible.length]!;
  const voice = voiceFor(moment, speaker.seatIndex);
  const others = game.players
    .map((player) => player.seatIndex)
    .filter((seat) => seat !== speaker.seatIndex)
    .toSorted((a, b) => a - b);
  const addressedSeat =
    voice.addressedSeat ?? others[hash(`${seed}:table-talk:${momentKey}:to`) % others.length];
  if (addressedSeat === undefined || addressedSeat === speaker.seatIndex) return null;
  const listener = view.opponents.find(
    (opponent) => opponent.seatIndex === addressedSeat && seatIn(opponent.seatIndex),
  );
  const exchange =
    listener !== undefined &&
    inRound.filter((entry) => entry.kind === 'exchange').length < TABLE_TALK.maxExchangesPerRound;
  return {
    moment,
    speakerSeat: speaker.seatIndex,
    personalityId: speaker.personality,
    situation: voice.situation,
    addressedSeat,
    listener: exchange ? { seat: listener.seatIndex, personalityId: listener.personality } : null,
  };
}

/** The saved table talk of a game, oldest first. */
export function spokenLines(
  dialogueEvents: readonly { kind: string }[] | undefined,
): AiSpeechEvent[] {
  return (dialogueEvents ?? []).filter(
    (event): event is AiSpeechEvent => event.kind === 'ai_speech',
  );
}

const RETORT_PREFIX = 'table-retort-';

/**
 * Whether `line` is the answer to `opening`: the same turn, the same two seats, the roles swapped,
 * and either both written by Haiku or the answer a line-bank retort to a bank line.
 */
const answers = (opening: AiSpeechEvent | undefined, line: AiSpeechEvent): boolean =>
  opening !== undefined &&
  opening.globalTurnNo === line.globalTurnNo &&
  opening.addressedSeatIndex === line.speakerSeatIndex &&
  line.addressedSeatIndex === opening.speakerSeatIndex &&
  (opening.source === 'haiku'
    ? line.source === 'haiku'
    : line.source === 'bank' && (line.lineId?.startsWith(RETORT_PREFIX) ?? false));

/** One entry of the table talk panel: a line said on its own, or an opening line and its answer. */
export type TalkEntry =
  | { readonly kind: 'line'; readonly line: AiSpeechEvent }
  | { readonly kind: 'exchange'; readonly opening: AiSpeechEvent; readonly reply: AiSpeechEvent };

/**
 * The saved lines as the panel shows them, oldest first. An exchange is saved as its two lines,
 * the answer straight after the opening; the log has no other mark, so the pairing is read from
 * who spoke to whom in which turn.
 */
export function talkEntries(lines: readonly AiSpeechEvent[]): TalkEntry[] {
  const entries: TalkEntry[] = [];
  for (const line of lines) {
    const previous = entries.at(-1);
    if (previous?.kind === 'line' && answers(previous.line, line)) {
      entries[entries.length - 1] = { kind: 'exchange', opening: previous.line, reply: line };
    } else entries.push({ kind: 'line', line });
  }
  return entries;
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
    situation: plan.situation,
    addressedSeat: plan.addressedSeat,
    personalityId: plan.personalityId,
    turnKey: `talk:${momentKey}`,
  };
}

/**
 * `POST /api/ai/speak`'s body for the listener's answer (`kind: 'reply'`). Like `speakBody`, the
 * listener's own hand, Balls and peek results are never sent: `own` is empty and only the public
 * game and the line being answered go to the route (spec §4.1, §5.4).
 */
export function replyBody(args: {
  gameId: string;
  plan: TalkPlan & { listener: ExchangeListener };
  game: PublicGame;
  momentKey: number;
  quote: string;
}): unknown {
  const { gameId, plan, game, momentKey, quote } = args;
  return {
    kind: 'reply',
    gameId,
    seatIndex: plan.listener.seat,
    stateRevision: game.stateRevision,
    observation: {
      public: game,
      own: {
        seatIndex: plan.listener.seat,
        items: [],
        balls: { poke: 0, great: 0, ultra: 0 },
        privateResults: [],
      },
    },
    speakerSeat: plan.speakerSeat,
    quote,
    situation: 'table_retort',
    personalityId: plan.listener.personalityId,
    turnKey: `talk:${momentKey}:reply`,
  };
}

export interface SpokenAnswer {
  readonly source: 'haiku' | 'bank';
  readonly text: string;
  readonly lineId?: string;
}

/** One call to the speech route; every failure, and a reply with no usable line, is `null`. */
async function postSpeech(body: unknown, signal: AbortSignal): Promise<SpokenAnswer | null> {
  const response = await fetch('/api/ai/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
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
}

/**
 * Runs `run` against a deadline and the caller's abort: whichever comes first ends the wait with
 * `null`, even if the network answers later, and the request underneath is aborted.
 */
async function withinDeadline<T>(
  ms: number,
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> {
  if (signal.aborted) return null;
  const controller = new AbortController();
  const { promise, resolve } = Promise.withResolvers<T | null>();
  const abort = () => resolve(null);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, ms);
  void run(controller.signal).then(resolve, () => resolve(null));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', abort);
  }
}

/**
 * Asks the speech route for one line. A line that is not here within `TABLE_TALK.deadlineMs` is
 * dropped even if it arrives later, and nothing is retried. Every failure, and a reply with no line,
 * is `null`; the caller then takes a bank line, and the game never waits for any of this.
 */
export const requestSpeech = (body: unknown, signal: AbortSignal): Promise<SpokenAnswer | null> =>
  withinDeadline(TABLE_TALK.deadlineMs, signal, (inner) => postSpeech(body, inner));

export interface ExchangeAnswer {
  readonly opening: string;
  readonly reply: string;
}

/**
 * Asks for a whole exchange (spec §5.7): the opening line, then the other AI's answer to it. Both
 * must be generated lines and both must be here within `TABLE_TALK.deadlineMs`; anything less,
 * including a line the server's manipulation check refused, is `null` and nothing of it is shown.
 * Nothing is retried, and the opening line is never shown before the answer is in. The caller
 * then takes a bank line, so the table is not left silent.
 */
export const requestExchange = (
  opening: unknown,
  replyTo: (line: string) => unknown,
  signal: AbortSignal,
): Promise<ExchangeAnswer | null> =>
  withinDeadline(TABLE_TALK.deadlineMs, signal, async (inner) => {
    const first = await postSpeech(opening, inner);
    // Out of time or called off while the opening was out: the answer is never asked for.
    if (first?.source !== 'haiku' || inner.aborted) return null;
    const second = await postSpeech(replyTo(first.text), inner);
    return second?.source === 'haiku' ? { opening: first.text, reply: second.text } : null;
  });

/** `ai.line.<id>` keys of a situation's bank lines for a personality at neutral trust, in id order. */
const bankIds = (situation: TalkSituation | 'table_retort', personalityId: string): string[] => {
  const prefix = `ai.line.${situation.replaceAll('_', '-')}-${personalityId}-neutral-`;
  return Object.keys(en)
    .filter((key) => key.startsWith(prefix))
    .toSorted();
};

/** How many of the latest saved lines a bank pick steers clear of, so a table does not repeat itself. */
export const RECENT_LINES = 8;

/**
 * A line from the bank, picked by the seed and steering clear of the ones said in `recent` (line
 * IDs from the saved lines, so a reload picks the same): the answer that never fails. It is what
 * a game with Haiku off says, and what takes over when the route is late, down or has nothing to say.
 */
function pickBank(
  situation: TalkSituation | 'table_retort',
  personalityId: string,
  label: string,
  recent: readonly string[],
): SpokenAnswer | null {
  const ids = bankIds(situation, personalityId);
  const fresh = ids.filter((key) => !recent.includes(key.slice('ai.line.'.length)));
  const pool = fresh.length > 0 ? fresh : ids;
  const key = pool[hash(label) % pool.length];
  return key === undefined
    ? null
    : { source: 'bank', lineId: key.slice('ai.line.'.length), text: en[key as keyof typeof en] };
}

export function bankAnswer(
  situation: TalkSituation,
  personalityId: string,
  seed: string | number,
  momentKey: number,
  recent: readonly string[] = [],
): SpokenAnswer | null {
  return pickBank(
    situation,
    personalityId,
    `${seed}:bank:${situation}:${personalityId}:${momentKey}`,
    recent,
  );
}

/** The listener's bank answer to a bank opening line. */
export const retortAnswer = (
  personalityId: string,
  seed: string | number,
  momentKey: number,
  recent: readonly string[] = [],
): SpokenAnswer | null =>
  pickBank('table_retort', personalityId, `${seed}:retort:${personalityId}:${momentKey}`, recent);

/**
 * The `ai_speech` event for an answer, or null when nothing may be shown: a bank line with the
 * engine's own facts in its slots (the addressed seat's class, the species, the coins of a sale)
 * and no slot left over. A bank line that names no one is said to the table.
 */
export function speechEvent(
  plan: TalkPlan,
  answer: SpokenAnswer,
  game: PublicGame,
): AiSpeechEvent | null {
  const { moment, speakerSeat, addressedSeat } = plan;
  const base = {
    kind: 'ai_speech' as const,
    speakerSeatIndex: speakerSeat,
    globalTurnNo: moment.turn,
  };
  if (answer.source === 'haiku') {
    const text = answer.text.trim();
    return text.length > 0 && text.length <= 280
      ? { ...base, addressedSeatIndex: addressedSeat, source: 'haiku', text }
      : null;
  }
  const key = `ai.line.${answer.lineId}` as const;
  const addressed = game.players.find((player) => player.seatIndex === addressedSeat);
  if (!Object.hasOwn(en, key) || !addressed) return null;
  const template = en[key as keyof typeof en];
  const text = t(key, {
    target: className(addressed.classId),
    ...(moment.pokemon !== undefined && { pokemon: moment.pokemon }),
    ...(moment.coins !== undefined && { coins: moment.coins }),
  });
  if (/[{}]/.test(text)) return null;
  return {
    ...base,
    ...(template.includes('{target}') && { addressedSeatIndex: addressedSeat }),
    source: 'bank',
    lineId: answer.lineId!,
    text,
  };
}

/** The two `ai_speech` events of a generated exchange, opening first, or null when either cannot be saved. */
export function exchangeEvents(
  plan: TalkPlan & { listener: ExchangeListener },
  answer: ExchangeAnswer,
): [AiSpeechEvent, AiSpeechEvent] | null {
  const { moment, speakerSeat, listener } = plan;
  const opening = answer.opening.trim();
  const reply = answer.reply.trim();
  if ([opening, reply].some((text) => text.length === 0 || text.length > 280)) return null;
  const base = { kind: 'ai_speech' as const, source: 'haiku' as const, globalTurnNo: moment.turn };
  return [
    { ...base, speakerSeatIndex: speakerSeat, addressedSeatIndex: listener.seat, text: opening },
    { ...base, speakerSeatIndex: listener.seat, addressedSeatIndex: speakerSeat, text: reply },
  ];
}

/**
 * The listener's line-bank retort to a line-bank opening, addressed to the opening speaker. The
 * bank answers an exchange when Haiku is off, late or refused. Null when the line cannot be saved.
 */
export function retortEvent(
  plan: TalkPlan & { listener: ExchangeListener },
  answer: SpokenAnswer,
  game: PublicGame,
): AiSpeechEvent | null {
  const { moment, speakerSeat, listener } = plan;
  const key = `ai.line.${answer.lineId}` as const;
  const opener = game.players.find((player) => player.seatIndex === speakerSeat);
  if (answer.source !== 'bank' || !answer.lineId?.startsWith(RETORT_PREFIX)) return null;
  if (!Object.hasOwn(en, key) || !opener) return null;
  const text = t(key, { target: className(opener.classId) });
  if (/[{}]/.test(text)) return null;
  return {
    kind: 'ai_speech',
    speakerSeatIndex: listener.seat,
    addressedSeatIndex: speakerSeat,
    globalTurnNo: moment.turn,
    source: 'bank',
    lineId: answer.lineId,
    text,
  };
}

export type VoiceReason = 'disabled' | 'missing_key' | 'budget_exceeded';

const VOICE_REASON_TEXT: Record<VoiceReason, MessageKey> = {
  disabled: 'talk.reason.disabled',
  missing_key: 'talk.reason.missing_key',
  budget_exceeded: 'talk.reason.budget_exceeded',
};

/** The "Voice off" badge's explanation: what the status route and the speech route may say (spec §3.1, §9). */
export const voiceReasonText = (reason: VoiceReason): string => t(VOICE_REASON_TEXT[reason]);

/**
 * Why generated speech is off, from `GET /api/ai/status`: only a reason the server gave (spec §3,
 * §9). An unreachable or older status says nothing, so no badge is shown for it.
 */
export function voiceOff(status: Pick<AiStatus, 'speech'> | null): VoiceReason | null {
  const speech = status?.speech;
  if (speech?.enabled !== false) return null;
  return speech.reason;
}
