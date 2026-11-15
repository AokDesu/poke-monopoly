import type { GameState } from '../../../engine/index.ts';
import type { TurnPlayback } from '../board/useTurnPlayback.ts';
import type { AiDecision } from '../game/ai.ts';
import { content, engineContent } from '../game/content.ts';
import { createFixtureStore, type GameStore, type SeatView } from '../game/store.ts';

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
  };
}
