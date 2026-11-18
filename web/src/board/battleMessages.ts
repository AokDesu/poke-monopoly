import type { SeatEvent } from '../../../engine/index.ts';
import { currentForm } from '../game/content.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ownSeatOf, playerLabel, seatLabel, type ViewedObservation } from './labels.ts';

export interface BattleMessage {
  key: MessageKey;
  text: string;
}

/** The public phase a record was applied in: it names a battle's seats, which its events do not. */
type Before = SeatFeedEntry['before'];

/** A team member wherever it sits now; its current form is public (§4.1). */
const memberOf = (observation: ViewedObservation, instanceId: string) =>
  observation.public.players
    .flatMap((player) => player.team)
    .find((member) => member.instanceId === instanceId);

const PROTECTION = {
  price: 'board.event.protection.price',
  battle_coin_loss: 'board.event.protection.battle_coin_loss',
  nurse_joy: 'board.event.protection.nurse_joy',
} as const satisfies Record<string, MessageKey>;

/**
 * Announcements for the PvP, Gym, protection, Ability and evolution events (spec §4.4, §4.5,
 * Appendix C). `event` is already seat-filtered, so a hidden hostile attempt never arrives here.
 * `before` is the phase the record was applied in; without it (a fixture board's bare events) a
 * result cannot name its seats and is left out. Any other event returns an empty list.
 */
export function battleEventMessages(
  event: SeatEvent,
  observation: ViewedObservation,
  before?: Before,
): BattleMessage[] {
  const own = ownSeatOf(observation);
  const seat = (index: number) => seatLabel(index, own);
  const actor = (actorId: string) => playerLabel(observation, actorId);
  const message = (key: MessageKey, values?: Record<string, string | number>) => [
    { key, text: t(key, values) },
  ];
  const pokemonName = (instanceId: string) => {
    const member = memberOf(observation, instanceId);
    return member ? speciesName(member.speciesId) : t('board.event.aPokemon');
  };
  switch (event.kind) {
    case 'attack_attempt':
      // Hostile item and Ability attempts are announced by their own events.
      return event.source === 'pvp_declaration'
        ? message('board.event.challenge', {
            name: actor(event.actorId),
            target: actor(event.targetId),
          })
        : [];
    case 'pvp_response':
      return message(event.accepted ? 'board.event.accepted' : 'board.event.declined', {
        name: actor(event.defenderId),
      });
    case 'pvp_confirmed':
      return message('board.event.pvpConfirmed');
    case 'pvp_resolved': {
      if (before?.phase.kind !== 'pvp') return [];
      const { attackerSeatIndex, defenderSeatIndex } = before.phase.battle;
      const winner =
        event.outcome === 'win'
          ? attackerSeatIndex
          : event.outcome === 'loss'
            ? defenderSeatIndex
            : undefined;
      return message('board.event.pvpResolved', {
        attacker: seat(attackerSeatIndex),
        attackerFace: event.attackerFace,
        attackerTotal: event.attackerTotal,
        defender: seat(defenderSeatIndex),
        defenderFace: event.defenderFace,
        defenderTotal: event.defenderTotal,
        outcome:
          winner === undefined
            ? t('board.event.pvpTie')
            : t('board.event.pvpWon', { name: seat(winner) }),
      });
    }
    case 'gym_confirmed':
      return message('board.event.gymConfirmed', {
        name: seat(event.snapshot.challenger.seatIndex),
        dc: event.snapshot.dc,
      });
    case 'gym_resolved':
      return before
        ? message('board.event.gymResolved', {
            name: seat(before.activeSeatIndex),
            face: event.face,
            total: event.total,
            dc: event.dc,
            outcome: t(event.outcome === 'win' ? 'board.event.gymWon' : 'board.event.gymLost'),
          })
        : [];
    case 'badge_awarded':
      return message('board.event.badge', { name: actor(event.ownerId) });
    case 'battle_reward_resolved':
      // A coin transfer and an evolution have their own rows; only an empty transfer needs one.
      return event.choice.kind === 'coins' && event.coinAmount === 0
        ? message('board.event.rewardNoCoins', { name: actor(event.winnerId) })
        : [];
    case 'pokemon_evolved': {
      const yours = observation.public.players.some(
        (player) => player.actorId === event.ownerId && player.seatIndex === own,
      );
      return message(yours ? 'board.event.evolvedYours' : 'board.event.evolved', {
        owner: actor(event.ownerId),
        from: speciesName(event.fromFormId),
        to: speciesName(event.toFormId),
      });
    }
    case 'protection_applied': {
      const protection = t(PROTECTION[event.protection]);
      return event.source === 'hostile_item' || event.source === 'hostile_ability'
        ? message('board.event.protectionHostile', {
            name: actor(event.targetId),
            protection,
            actor: actor(event.actorId),
          })
        : message('board.event.protectionCoins', { name: actor(event.targetId), protection });
    }
    case 'shield_armed':
      return message('board.event.shieldArmed', { name: actor(event.ownerId) });
    case 'ability_activated': {
      const member = memberOf(observation, event.instanceId);
      const ability = member ? currentForm(member.speciesId).ability?.name : undefined;
      const values = {
        name: actor(event.ownerId),
        ability: ability ?? t('board.event.anAbility'),
      };
      return event.targetId
        ? message('board.event.abilityOn', { ...values, target: actor(event.targetId) })
        : message('board.event.ability', values);
    }
    case 'abilities_reset':
      return message('board.event.abilitiesReset', { name: actor(event.ownerId) });
    case 'status_changed':
      return message(
        event.operation === 'cleared' ? 'board.event.recovered' : 'board.event.tired',
        { pokemon: pokemonName(event.instanceId) },
      );
    default:
      return [];
  }
}
