import {
  applyAction,
  createGame,
  createGameConfig,
  dealFacts,
  type DealTerms,
  type GameState,
  type PokemonInstance,
} from '../../engine/index.ts';
import { command } from '../../sim/runner.ts';
import { content } from './scenario-kit.ts';
import { CONTENT } from '../../ai/questions/content.ts';

/** The AI seat in every Deal Card scenario; seat 0 is the human who proposes (spec §4.8: only the human proposes). */
export const DEAL_AI_SEAT = 1;
export const DEAL_HUMAN_SEAT = 0;

export interface DealTable {
  seed: number;
  /** Coins for [human, AI]. */
  coins: readonly [number, number];
  /** Pokémon given to the human and to the AI, besides each one's Starter. */
  humanTeam?: readonly PokemonInstance[];
  aiTeam?: readonly PokemonInstance[];
  /** Secret items held by the human (instance IDs `item:0:<n>`) and by the AI. */
  humanItems?: readonly string[];
  aiItems?: readonly string[];
  /** The AI's trust in the human, -3..3 (§4.8); none by default. */
  trust?: number;
  /** Concession the AI has already spent in earlier deals (§4.8), so a game's budget is partly used. */
  spent?: number;
}

const itemOf = (seat: number, n: number, itemId: string) => ({
  instanceId: `item:${seat}:${n}`,
  itemId,
  name: CONTENT.items.find((item) => item.id === itemId)!.name,
  visibility: 'secret' as const,
});

export const owned = (
  seat: number,
  n: number,
  speciesId: string,
  extra: Partial<PokemonInstance> = {},
) => ({
  instanceId: `caught:${seat}:${n}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: true,
  ...extra,
});

/**
 * A Social window in which seat 0 (a human) may propose a Deal Card to seat 1 (an AI), with the budgets of a
 * fresh game. The state is the engine's own: the scenarios reach their pending question by an accepted action.
 */
export function dealTable(table: DealTable): GameState {
  const state = createGame(
    createGameConfig({
      seats: [
        {
          classId: 'main-character',
          starterSpeciesId: 'charmander',
          actorId: 'P1',
          seatIndex: 0,
          controller: 'human',
        },
        { classId: 'rival', actorId: 'P2', seatIndex: 1, controller: 'ai' },
      ],
      seed: table.seed,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 5;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  state.players.forEach((player) => {
    player.ownTurnNo = 3;
    player.routeProgress = 30;
    player.creditedLap = 1;
    player.coins = table.coins[player.seatIndex]!;
  });
  const [human, ai] = state.players as [GameState['players'][number], GameState['players'][number]];
  human.team.push(...(table.humanTeam ?? []));
  ai.team.push(...(table.aiTeam ?? []));
  (table.humanItems ?? []).forEach((id, n) => human.items.push(itemOf(0, n, id)));
  (table.aiItems ?? []).forEach((id, n) => ai.items.push(itemOf(1, n, id)));
  if (table.trust !== undefined && table.trust !== 0) {
    state.trust = [
      {
        fromSeatIndex: DEAL_AI_SEAT,
        toSeatIndex: DEAL_HUMAN_SEAT,
        value: table.trust,
        keptGain: 0,
      },
    ];
  }
  if (table.spent) ai.dealConcessionSpent = table.spent;
  return state;
}

const side = (coins = 0, pokemon: string[] = [], items: string[] = []) => ({
  coins,
  pokemonInstanceIds: pokemon,
  itemInstanceIds: items,
});

/** What the human proposes: it sells the AI a Pokémon or an item, or buys one of the AI's, for `coins`. */
export type DealOffer =
  | { sells: { pokemon: string } | { item: string }; coins: number }
  | { buys: { pokemon: string } | { item: string }; coins: number };

export function termsOf(offer: DealOffer): DealTerms {
  const [kind, asset] =
    'sells' in offer ? (['sells', offer.sells] as const) : (['buys', offer.buys] as const);
  const mine = 'pokemon' in asset ? side(0, [asset.pokemon]) : side(0, [], [asset.item]);
  return kind === 'sells'
    ? { give: mine, get: side(offer.coins) }
    : { give: side(offer.coins), get: mine };
}

/** The human proposes `offer` to the AI through the engine, leaving the AI's answer pending. */
export function proposeDeal(state: GameState, offer: DealOffer): GameState {
  const human = state.players[DEAL_HUMAN_SEAT]!;
  const terms = termsOf(offer);
  const result = applyAction(
    state,
    command(state, human.actorId, {
      id: 'propose',
      kind: 'propose_deal',
      payload: { targetSeatIndex: DEAL_AI_SEAT, ...terms },
    }),
  );
  if ('rejected' in result) throw new Error(`The deal was refused: ${result.reason}`);
  return result.state;
}

/** The engine's buckets for the AI answering the pending Deal Card. */
export const factsOf = (state: GameState) => dealFacts(state, DEAL_AI_SEAT);
