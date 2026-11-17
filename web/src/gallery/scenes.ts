import type { GameState, PokemonInstance } from '../../../engine/index.ts';
import type { TurnPlayback } from '../board/useTurnPlayback.ts';
import type { AiDecision } from '../game/ai.ts';
import { content, engineContent } from '../game/content.ts';
import {
  createFixtureStore,
  type GameStore,
  type SeatView,
  type SpectatorView,
} from '../game/store.ts';

/**
 * Deterministic game states for the dev gallery (issue #53). Every state is a committed engine
 * fixture, moved on only through the store's own commands, so each screen reads real engine
 * output (observations, legal actions, quotes, accepted records) and never a hand-drawn copy.
 */

/** The engine fixtures the gallery starts from, read in Node by the dev plugin (`board-fixtures.ts`). */
export interface GalleryFixtures {
  readonly 'encounter-no-ball': unknown;
  readonly 'sell-phase-three-pokemon': unknown;
  readonly 'shop-low-coins': unknown;
  readonly 'shop-no-coins': unknown;
}

export interface Scene {
  readonly store: GameStore;
  readonly view: SeatView;
}

const sceneOf = (store: GameStore): Scene => ({ store, view: store.getView()! });

/** A game with no human seat, read as its watcher reads it: the public-only view. */
export interface WatchScene {
  readonly store: GameStore;
  readonly view: SpectatorView;
}

/** A frozen playback: nothing is thinking, speaking or failing, and no clock runs. */
export const STATIC_PLAYBACK: TurnPlayback = {
  speed: 'normal',
  setSpeed: () => {},
  status: null,
  statusUnavailable: false,
  thinking: false,
  failed: false,
  line: null,
  skipLine: () => {},
  retry: () => {},
  paused: false,
  setPaused: () => {},
  step: () => {},
  stepBlocked: null,
  skipToEnd: () => {},
};

/** A rival seat cloned from seat 1: only what the human seat may see of it. */
function addRival(state: GameState, seatIndex: number): void {
  const source = state.players[1]!;
  const actorId = `player-${seatIndex}`;
  state.players.push({
    ...structuredClone(source),
    actorId,
    seatIndex,
    team: source.team.map((member) => ({ ...member, instanceId: `pokemon-${seatIndex}` })),
  });
  state.config.seats.push({ actorId, seatIndex, classId: 'researcher', controller: 'ai' });
}

/** A caught Pokémon of `speciesId` with a fresh instance ID, ready to use its Ability. */
const caught = (speciesId: string, abilityReady = true) => ({
  instanceId: `gallery:${speciesId}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady,
});

/** The human (seat 0) opens Strategy at `globalTurnNo` 7 holding `team`, with every budget unspent. */
function openStrategy(state: GameState, team: PokemonInstance[]): void {
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 0;
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.team = team;
}

export function createScenes(fixtures: GalleryFixtures) {
  return {
    /** §3.1: a wild Pokémon appears and the pouch holds no Ball. The only legal action is Release. */
    noBallEncounter: (): Scene =>
      sceneOf(createFixtureStore(fixtures['encounter-no-ball'], engineContent)),

    /** The same encounter once the engine applied the sole Release itself (`auto: true`). */
    noBallAutoReleased: (): Scene => {
      const store = createFixtureStore(fixtures['encounter-no-ball'], engineContent);
      if (!store.advance({ human: true })) {
        throw new Error('Gallery: the sole Release did not apply');
      }
      return sceneOf(store);
    },

    /** §3.1: 0 coins, so no offer is affordable. */
    shopNothingAffordable: (): Scene =>
      sceneOf(createFixtureStore(fixtures['shop-no-coins'], engineContent)),

    /** §3.1: four utility items held while coins remain; Balls stay buyable. */
    shopItemsFull: (): Scene =>
      sceneOf(
        createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
          state.players[0]!.coins = 20;
          state.players[0]!.items = Array.from({ length: 4 }, (_, n) => ({
            instanceId: `owned-${n}`,
            itemId: 'repel',
            name: content.items.find((item) => item.id === 'repel')!.name,
            visibility: 'secret',
          }));
        }),
      ),

    /**
     * Seat 1 (an AI) has just left the Shop. `answer` is how its decision reached the engine and
     * `rivals` is how many AI seats the game has.
     */
    rivalLeftShop: (answer: AiDecision, rivals: 1 | 2): Scene => {
      const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
        state.activeSeatIndex = 1;
        if (rivals === 2) addRival(state, 2);
      });
      const result = store.submit({ actorId: 'player-1', kind: 'skip_shop', payload: {} });
      if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
      const view = store.getView()!;
      return {
        store,
        view: { ...view, feed: view.feed.map((entry) => ({ ...entry, decision: answer })) },
      };
    },

    /**
     * A watched game: every seat is an AI and seat 1 holds an open decision, which is what a
     * closed browser leaves behind (§3.1, "A watched game's browser closes").
     */
    watchDecisionOpen: (): WatchScene => {
      const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
        for (const seat of state.config.seats) seat.controller = 'ai';
        state.activeSeatIndex = 1;
      });
      return { store, view: store.getSpectatorView()! };
    },

    /** Seat 1 (an AI) holds a decision that is still open: what a resumed save asks again. */
    rivalDecisionOpen: (): Scene =>
      sceneOf(
        createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
          state.activeSeatIndex = 1;
        }),
      ),

    /** §3.1 / §4.7: the Sell Phase with a full team of three, before selling any of it. */
    sellPhaseFullTeam: (): Scene & { teamIds: readonly string[] } => {
      const store = createFixtureStore(fixtures['sell-phase-three-pokemon'], engineContent);
      const view = store.getView()!;
      const you = view.observation.public.players.find((p) => p.seatIndex === view.seatIndex)!;
      return { store, view, teamIds: you.team.map((member) => member.instanceId) };
    },

    /** The same Sell Phase after the whole team was sold in one batch. */
    wholeTeamSold: (): Scene => {
      const store = createFixtureStore(fixtures['sell-phase-three-pokemon'], engineContent);
      const view = store.getView()!;
      const you = view.observation.public.players.find((p) => p.seatIndex === view.seatIndex)!;
      const result = store.submit({
        actorId: you.actorId,
        kind: 'sell',
        payload: { pokemonInstanceIds: you.team.map((member) => member.instanceId) },
      });
      if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
      return sceneOf(store);
    },

    /**
     * §4.5, Appendix C: Strategy with one Pokémon per Ability state: ready (Quick Flight), wrong
     * timing (Blaze), used this Lap (Vine Pull) and not run by the engine yet (Scavenge).
     */
    abilityStrategy: (): Scene =>
      sceneOf(
        createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) =>
          openStrategy(state, [
            caught('pidgey'),
            caught('charmander'),
            caught('bulbasaur', false),
            caught('rattata'),
          ]),
        ),
      ),

    /**
     * Appendix C.3: an AI rival challenges the human, who accepts. The human answers outside their
     * own turn: Heal Pulse (a reaction) is ready, Calculate is not usable in this window.
     */
    abilityReaction: (): Scene => {
      const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
        openStrategy(state, [
          caught('chansey'),
          { ...caught('pikachu'), tired: true },
          caught('porygon'),
        ]);
        state.activeSeatIndex = 1;
        state.players[1]!.team = [caught('rattata', false)];
      });
      const you = store.getView()!.observation.public.players[0]!;
      const challenge = store.submit({
        actorId: 'player-1',
        kind: 'declare_pvp',
        payload: { targetSeatIndex: 0 },
      });
      if ('rejected' in challenge) throw new Error(`Gallery: ${challenge.reason}`);
      const accepted = store.submit({
        actorId: you.actorId,
        kind: 'respond_pvp',
        payload: { accept: true },
      });
      if ('rejected' in accepted) throw new Error(`Gallery: ${accepted.reason}`);
      return sceneOf(store);
    },
  };
}
