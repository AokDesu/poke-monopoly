import fallbackNotice from '../../../content/lines/en/fallback_notice.json';
import type { AiSpeechEvent, Observation, SeatEvent } from '../../../engine/index.ts';
import { content, currentForm, squareOf } from '../game/content.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { className, itemName, speciesName } from '../i18n/names.ts';

/**
 * The table's story of each turn (spec §3, AI turns): every seat-visible record of a turn, told as
 * short beats ("Rolled 3 → Wild 5", "Found Magikarp · threw a Poké Ball", "Caught Magikarp").
 * A record that changes nothing a player acts on (a skip, a phase change, an automatic roll) is
 * filler and makes no beat. Beats read only the records the viewing seat may see, so a rival's
 * secret item or Ball pouch never reaches them: a rival's purchase is "bought from the Shop", and
 * an item is named only to the seat it was used on (spec §4.1).
 */

export interface Beat {
  /** Whose turn the beat tells. */
  readonly seatIndex: number;
  readonly turn: number;
  /** The feed entry it comes from. */
  readonly at: number;
  readonly key: MessageKey;
  readonly text: string;
  /** A choice the seat made (a Ball thrown, a purchase, a challenge), or a result the game applied. */
  readonly kind: 'choice' | 'result';
  /** It touched the viewing seat: a hostile item or Ability on it, a battle with it, its coins taken. */
  readonly touchedYou: boolean;
}

export interface BeatContext {
  /** The public board and seats: names and squares only. */
  readonly game: Pick<Observation['public'], 'players' | 'board'>;
  /** The seat the table is read from; undefined for a watcher, who holds none. */
  readonly viewerSeat: number | undefined;
}

type Draft = Omit<Beat, 'seatIndex' | 'turn' | 'at'>;

const FALLBACK_NOTICES = new Set(fallbackNotice.map((line) => line.id));

/** "+5" or "−3": a coin amount the engine recorded, signed from the story seat's side. */
export const signedCoins = (amount: number) =>
  amount < 0 ? t('beat.minus', { amount: -amount }) : t('beat.plus', { amount });

/** A seat as a beat names it: "you" for the viewing seat, else its class (unique in a game). */
function seatName(seatIndex: number, context: BeatContext): string {
  if (seatIndex === context.viewerSeat) return t('beat.you');
  const player = context.game.players.find((entry) => entry.seatIndex === seatIndex);
  return player ? className(player.classId) : t('board.event.player');
}

const seatOfActor = (actorId: string, context: BeatContext) =>
  context.game.players.find((player) => player.actorId === actorId)?.seatIndex;

function squareName(position: number, context: BeatContext): string {
  const space = context.game.board.find((entry) => entry.position === position);
  return space
    ? t('beat.square', { kind: t(`board.kind.${space.kind}`), position })
    : String(position);
}

const pokemonOf = (entry: SeatFeedEntry, instanceId: string) =>
  entry.before.pokemon.find((member) => member.instanceId === instanceId);

/**
 * Every beat of the feed, in order. The list only grows as the feed grows: a record's beats depend
 * on it and the records before it, never on later ones, so a beat keeps its place once shown.
 */
export function tableBeats(feed: readonly SeatFeedEntry[], context: BeatContext): Beat[] {
  const beats: Beat[] = [];
  let turn = -1;
  let roll: number | undefined;
  let thrown = false;
  feed.forEach((entry, at) => {
    const { before, record } = entry;
    // The first-player roll belongs to no seat's turn.
    if (before.globalTurnNo < 1) return;
    if (before.globalTurnNo !== turn) {
      turn = before.globalTurnNo;
      roll = undefined;
      thrown = false;
    }
    const seatIndex = before.activeSeatIndex;
    for (const event of record.events) {
      if (event.kind === 'random_result' && event.purpose.startsWith('move:')) {
        if (typeof event.result === 'number') roll = event.result;
      }
    }
    const drafts = recordBeats(entry, context, { roll, thrown });
    if (record.action.kind === 'catch') thrown = true;
    if (before.phase.kind !== 'encounter') thrown = false;
    for (const draft of drafts) beats.push({ ...draft, seatIndex, turn, at });
  });
  return beats;
}

/** The beats one accepted record adds to the active seat's story; filler adds none. */
function recordBeats(
  entry: SeatFeedEntry,
  context: BeatContext,
  turn: { roll: number | undefined; thrown: boolean },
): Draft[] {
  const { before, record } = entry;
  const { action, events } = record;
  const seat = before.activeSeatIndex;
  const actor = context.game.players.find((player) => player.seatIndex === seat)?.actorId;
  const viewer = context.viewerSeat;
  const viewerActor = context.game.players.find((player) => player.seatIndex === viewer)?.actorId;
  const own = seat === viewer;
  const drafts: Draft[] = [];
  const add = (
    kind: Draft['kind'],
    key: MessageKey,
    values: Record<string, string | number> = {},
    touchedYou = false,
  ) => {
    // A beat may open with a seat's name, and "you" opens a sentence in capitals.
    const text = t(key, values);
    drafts.push({ kind, key, text: text.charAt(0).toUpperCase() + text.slice(1), touchedYou });
  };
  /** Coins that belong to the beat just added (a price, a sale, a Gym loss) join its text. */
  const join = (piece: string, touchedYou = false) => {
    const last = drafts.at(-1);
    if (!last) return false;
    drafts[drafts.length - 1] = {
      ...last,
      text: t('beat.join', { first: last.text, second: piece }),
      touchedYou: last.touchedYou || touchedYou,
    };
    return true;
  };
  const transfers = events.filter(
    (event): event is Extract<SeatEvent, { kind: 'coin_transfer' }> =>
      event.kind === 'coin_transfer',
  );
  const paid = (reason: string) =>
    transfers
      .filter((event) => event.reason === reason)
      .reduce((sum, event) => sum + event.amount, 0);

  // The seat's own choices (spec §4.2-§4.7). An engine-applied sole option is filler, except the
  // release a seat with no Ball is left with (§3.1).
  if (action.actorId === actor) {
    const encounter = before.phase.kind === 'encounter' ? before.phase.pokemon.speciesId : null;
    if (action.kind === 'catch' && encounter) {
      add('choice', 'beat.found', {
        pokemon: speciesName(encounter),
        ball: action.payload.ballType ? t(`board.ball.${action.payload.ballType}`) : '',
      });
    } else if (action.kind === 'release' && encounter) {
      add('choice', record.auto ? 'beat.foundNoBall' : 'beat.foundReleased', {
        pokemon: speciesName(encounter),
      });
    } else if (action.kind === 'buy') {
      const price = signedCoins(-paid('shop_purchase'));
      // Only the buyer's own copy says which offer was bought (§4.1); every other seat sees the
      // price alone, so a rival's row never names what it bought.
      const offer =
        own && before.phase.kind === 'shop'
          ? before.phase.offers.find((entry) => entry.id === action.payload.offerId)
          : undefined;
      if (offer) add('choice', 'beat.boughtOwn', { item: itemName(offer.itemId), coins: price });
      else add('choice', 'beat.bought', { coins: price });
    } else if (action.kind === 'use_item') {
      // A hostile item's name reaches only its user and its target (§4.1, §4.4).
      const hostile = events.find((event) => event.kind === 'hostile_item_used');
      if (hostile?.kind === 'hostile_item_used') {
        add(
          'choice',
          'beat.usedItemOn',
          { item: itemName(hostile.itemId), target: seatName(hostile.targetSeatIndex, context) },
          hostile.targetSeatIndex === viewer && !own,
        );
      } else add('choice', 'beat.usedItem');
    } else if (action.kind === 'sell') {
      const sold = events.flatMap((event) =>
        event.kind === 'uid_destroyed' && event.reason === 'sold' ? [event.instanceId] : [],
      );
      if (sold.length > 0) {
        add('choice', 'beat.sold', {
          pokemon: sold
            .map((instanceId) => {
              const member = pokemonOf(entry, instanceId);
              return member ? speciesName(member.speciesId) : t('board.event.aPokemon');
            })
            .join(t('beat.listJoin')),
          coins: signedCoins(paid('pokemon_sale') + paid('final_sale')),
        });
      }
    }
  }

  for (const event of events) {
    switch (event.kind) {
      case 'space_resolved':
        if (event.seatIndex !== seat) break;
        if (turn.roll === undefined) {
          add('result', 'beat.moveTo', { square: squareName(event.position, context) });
        } else {
          add('result', 'beat.move', {
            roll: turn.roll,
            square: squareName(event.position, context),
          });
        }
        break;
      case 'attack_attempt':
        // Hostile item and Ability attempts are told by their own events.
        if (event.source === 'pvp_declaration') {
          const target = seatOfActor(event.targetId, context);
          if (target !== undefined) {
            add(
              'choice',
              'beat.challenged',
              { target: seatName(target, context) },
              event.targetId === viewerActor && !own,
            );
          }
        }
        break;
      case 'pvp_response':
        if (!event.accepted) {
          const defender = seatOfActor(event.defenderId, context);
          if (defender !== undefined) {
            add('result', 'beat.declined', { name: seatName(defender, context) });
          }
        }
        break;
      case 'pvp_resolved': {
        if (before.phase.kind !== 'pvp') break;
        const { attackerSeatIndex, defenderSeatIndex } = before.phase.battle;
        const attacking = attackerSeatIndex === seat;
        const other = attacking ? defenderSeatIndex : attackerSeatIndex;
        const outcome =
          event.outcome === 'tie'
            ? 'tie'
            : (event.outcome === 'win') === attacking
              ? 'won'
              : 'lost';
        add(
          'result',
          outcome === 'tie' ? 'beat.pvpTied' : outcome === 'won' ? 'beat.pvpWon' : 'beat.pvpLost',
          {
            target: seatName(other, context),
            own: attacking ? event.attackerTotal : event.defenderTotal,
            other: attacking ? event.defenderTotal : event.attackerTotal,
          },
          other === viewer && !own,
        );
        break;
      }
      case 'gym_resolved':
        add('result', event.outcome === 'win' ? 'beat.gymWon' : 'beat.gymLost', {
          total: event.total,
          dc: event.dc,
        });
        break;
      case 'badge_awarded':
        if (!join(t('beat.badge'))) add('result', 'beat.badgeAlone');
        break;
      case 'pokemon_evolved':
        add('result', 'beat.evolved', {
          from: speciesName(event.fromFormId),
          to: speciesName(event.toFormId),
        });
        break;
      case 'ability_activated': {
        const member = pokemonOf(entry, event.instanceId);
        const ability = member ? currentForm(member.speciesId).ability?.name : undefined;
        const values = { ability: ability ?? t('board.event.anAbility') };
        // The target of a hostile Ability is in this copy only for its user and its target.
        const target = event.targetId ? seatOfActor(event.targetId, context) : undefined;
        if (target !== undefined && target !== seat) {
          add(
            'choice',
            'beat.abilityOn',
            { ...values, target: seatName(target, context) },
            target === viewer && !own,
          );
        } else add('choice', 'beat.ability', values);
        break;
      }
      case 'player_displaced': {
        const target = seatOfActor(event.targetId, context);
        if (target === undefined) break;
        const square = squareName(squareOf(event.to), context);
        if (target === seat) add('result', 'beat.moveTo', { square });
        else {
          add(
            'result',
            'beat.displaced',
            { target: seatName(target, context), square },
            target === viewer && !own,
          );
        }
        break;
      }
      case 'protection_applied': {
        const target = seatOfActor(event.targetId, context);
        if (target === undefined) break;
        const values = {
          target: seatName(target, context),
          protection: t(`board.event.protection.${event.protection}`),
        };
        const hostile = event.source === 'hostile_item' || event.source === 'hostile_ability';
        add(
          'result',
          hostile ? 'beat.blocked' : 'beat.covered',
          values,
          hostile && target === viewer && !own,
        );
        break;
      }
      case 'shield_armed':
        add('choice', 'beat.shield');
        break;
      case 'event_resolved':
        add('result', ...eventBeat(event, events, entry, context, seat));
        break;
      case 'uid_created':
        if (event.entity === 'pokemon' && before.phase.kind === 'sell') {
          add('result', 'beat.rescue');
        }
        break;
      case 'coin_transfer': {
        // Prices, sales and Event payouts are told with their own beat.
        if (
          event.reason.startsWith('event:') ||
          ['shop_purchase', 'pokemon_sale', 'final_sale'].includes(event.reason)
        ) {
          break;
        }
        const from =
          event.source.kind === 'player' ? seatOfActor(event.source.actorId, context) : undefined;
        const to =
          event.destination.kind === 'player'
            ? seatOfActor(event.destination.actorId, context)
            : undefined;
        const gained = to === seat;
        if (!gained && from !== seat) break;
        const coins = signedCoins(gained ? event.amount : -event.amount);
        if (event.reason === 'start_income') {
          add('result', 'beat.start', { coins });
          break;
        }
        const other = gained ? from : to;
        // Coins the seat whose turn it is took from the viewing seat; a Deal Card's payment was agreed.
        const taken =
          gained && other === viewer && viewer !== undefined && !own && event.reason !== 'deal';
        const piece =
          other === undefined
            ? coins
            : t(gained ? 'beat.coinsFrom' : 'beat.coinsTo', {
                coins,
                name: seatName(other, context),
              });
        // Coins that come with the record's own beat (a Gym loss, a stolen purse) join its text;
        // on their own they say what they are.
        const reward = event.reason === 'pvp_reward' || event.reason === 'gym_reward';
        if (!join(piece, taken)) {
          add('result', reward ? 'beat.reward' : 'beat.coins', { coins: piece }, taken);
        }
        break;
      }
      default:
        break;
    }
  }

  // A catch is told once it is final: a reroll window may still change the die (spec §4.3, C.6).
  if (
    before.phase.kind === 'encounter' &&
    action.kind !== 'release' &&
    events.some((event) => event.kind === 'phase_changed' && event.from === 'encounter')
  ) {
    const pokemon = speciesName(before.phase.pokemon.speciesId);
    if (events.some((event) => event.kind === 'uid_created' && event.entity === 'pokemon')) {
      add('result', 'beat.caught', { pokemon });
    } else if (turn.thrown || action.kind === 'catch') {
      add('result', 'beat.escaped', { pokemon });
    }
  }
  return drafts;
}

/** An Event card's result in the drawer's story; a rival's secret reward stays unnamed (§4.1). */
function eventBeat(
  resolved: Extract<SeatEvent, { kind: 'event_resolved' }>,
  events: readonly SeatEvent[],
  entry: SeatFeedEntry,
  context: BeatContext,
  seat: number,
): [MessageKey, Record<string, string | number>] {
  const { result } = resolved;
  switch (result.kind) {
    case 'encounter':
      return ['beat.event.encounter', { pokemon: speciesName(result.speciesId) }];
    case 'coins': {
      const moved = result.transfers.filter((transfer) => transfer.amount !== 0);
      if (moved.length === 0) return ['beat.event.coinsNone', {}];
      return [
        'beat.event.coins',
        {
          coins: moved
            .map((transfer) =>
              transfer.seatIndex === seat
                ? signedCoins(transfer.amount)
                : t('beat.event.seatCoins', {
                    name: seatName(transfer.seatIndex, context),
                    coins: signedCoins(transfer.amount),
                  }),
            )
            .join(t('beat.listJoin')),
        },
      ];
    }
    case 'tired': {
      const member = result.instanceId ? pokemonOf(entry, result.instanceId) : undefined;
      return member
        ? ['beat.event.tired', { pokemon: speciesName(member.speciesId) }]
        : ['beat.event.tiredNone', {}];
    }
    case 'item': {
      // Only the drawer's own copy holds the reward's identity.
      const item = events.find((event) => event.kind === 'item_gained');
      if (item?.kind === 'item_gained')
        return ['beat.event.item', { item: itemName(item.item.itemId) }];
      if (events.some((event) => event.kind === 'ball_gained')) {
        return ['beat.event.item', { item: t('board.ball.poke') }];
      }
      return ['beat.event.reward', {}];
    }
  }
}

/** The turn each seat played last (turn numbers from 1); a seat that has not played is absent. */
export function latestTurns(feed: readonly SeatFeedEntry[]): Map<number, number> {
  const turns = new Map<number, number>();
  for (const { before } of feed) {
    if (before.globalTurnNo >= 1) turns.set(before.activeSeatIndex, before.globalTurnNo);
  }
  return turns;
}

/** One line of speech inside a turn's story, with the label every line carries (spec §4.8, §5.7). */
export interface StorySpeech {
  readonly text: string;
  readonly source: 'haiku' | 'bank';
  /** The line is addressed to the viewing seat. */
  readonly toYou: boolean;
}

/**
 * The one line a seat says in its own turn's story: its first after-action line, else its first
 * table-talk line of that turn. The backup bot's notice is not speech: the seat row's Backup bot
 * badge says it, truthfully and once (spec §3).
 */
export function turnSpeech(
  feed: readonly SeatFeedEntry[],
  lines: readonly AiSpeechEvent[],
  seat: number,
  turn: number,
  context: BeatContext,
): StorySpeech | null {
  for (const entry of feed) {
    if (entry.before.globalTurnNo !== turn || entry.before.activeSeatIndex !== seat) continue;
    const lineId = entry.decision?.lineId;
    if (!lineId || FALLBACK_NOTICES.has(lineId)) continue;
    const text = afterActionLine(entry, lineId, context);
    if (text) return { text, source: 'bank', toYou: false };
  }
  const line = lines.find(
    (entry) => entry.speakerSeatIndex === seat && entry.globalTurnNo === turn,
  );
  return line
    ? {
        text: line.text,
        source: line.source,
        toYou:
          line.addressedSeatIndex !== undefined && line.addressedSeatIndex === context.viewerSeat,
      }
    : null;
}

/** A line-bank line chosen with a decision, its slots filled from the record; null if one is missing. */
function afterActionLine(
  entry: SeatFeedEntry,
  lineId: string,
  context: BeatContext,
): string | null {
  const key = `ai.line.${lineId}`;
  if (!Object.hasOwn(en, key)) return null;
  const encounter =
    entry.before.phase.kind === 'encounter' ? entry.before.phase.pokemon.speciesId : undefined;
  const species = content.species.find(
    (candidate) => candidate.id === (entry.lineContext?.pokemonSpeciesId ?? encounter),
  );
  const target = entry.lineContext?.targetSeatIndex;
  const text = t(key as MessageKey, {
    turn: entry.before.globalTurnNo,
    ...(target !== undefined
      ? { target: target === context.viewerSeat ? t('seat.you') : seatName(target, context) }
      : context.viewerSeat !== undefined && { target: t('seat.you') }),
    ...(species && { pokemon: species.name }),
    ...(entry.lineContext?.coins !== undefined && { coins: entry.lineContext.coins }),
  });
  // A missing slot never turns into an incomplete line.
  return /[{}]/.test(text) ? null : text;
}
