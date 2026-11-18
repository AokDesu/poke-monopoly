import type { GameState, LegalAction, PokemonInstance } from '../../../engine/index.ts';
import type { TurnPlayback } from '../board/useTurnPlayback.ts';
import type { AiDecision, OpponentAnswer } from '../game/ai.ts';
import { content, engineContent } from '../game/content.ts';
import { demoChoiceOf } from '../game/demoChoice.ts';
import { fakeJevAnswer, type FakeJevAnswerOptions } from '../game/fakeJevAnswer.ts';
import { readJevDetail } from '../game/jevDetailAdapter.ts';
import { seatDecision } from './seatDecision.ts';
import {
  createFixtureStore,
  type Command,
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

type Edit = (state: GameState) => void;

/** Applies one command through the store, so a scene only ever holds accepted engine records. */
function play(store: GameStore, command: Command): void {
  const result = store.submit(command);
  if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
}

/**
 * Seat 0 (the human, Charmander and Eevee) and seat 1 (a Rival-class AI with Eevee) in Strategy on
 * turn 7, with no Ability ready unless `edit` says so, so that no window opens by surprise.
 */
function battleStore(fixtures: GalleryFixtures, edit?: Edit): GameStore {
  return createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
    state.phase = { kind: 'strategy' };
    state.globalTurnNo = 7;
    state.activeSeatIndex = 0;
    state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
    for (const player of state.players) {
      player.ownTurnNo = 3;
      player.items = [];
      player.coins = 12;
      for (const member of player.team) member.abilityReady = false;
    }
    const human = state.players[0]!;
    human.team[0] = { ...human.team[0]!, speciesId: 'charmander' };
    human.team.push({ ...human.team[0]!, instanceId: 'pokemon-0b', speciesId: 'eevee' });
    edit?.(state);
  });
}

/** Applies the engine's pending dice until a decision or the end of the battle is reached. */
function rollDice(store: GameStore): void {
  while (['pvp', 'gym'].includes(store.getView()!.observation.public.phase.kind)) {
    if (!store.advance({ human: true })) return;
  }
}

/** Seat 0 holds a Gym square; the entry is open. `tired` leaves no battle-ready Pokémon. */
function gymStore(fixtures: GalleryFixtures, tired = false): GameStore {
  const store = battleStore(fixtures, (state) => {
    state.phase = { kind: 'resolve' };
    state.players[0]!.routeProgress = 12;
    if (tired) for (const member of state.players[0]!.team) member.tired = true;
  });
  const result = store.choose('skip');
  if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
  return store;
}

/** The human wins a PvP battle (fixture seed 3: the challenger's die beats the defender's). */
function wonBattle(fixtures: GalleryFixtures): GameStore {
  const store = battleStore(fixtures);
  play(store, { actorId: 'player-0', kind: 'declare_pvp', payload: { targetSeatIndex: 1 } });
  play(store, { actorId: 'player-1', kind: 'respond_pvp', payload: { accept: true } });
  rollDice(store);
  return store;
}

/** The human's own Social window with its one interaction unspent (spec §4.2). */
function openSocialWindow(state: GameState): void {
  state.config.socialWindow = true;
  state.phase = { kind: 'social' };
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
}

/**
 * Demo mode (issue #220): seat 1 (an AI) has just decided and the panel's data is made the way
 * the browser makes it, from a fake answer of the proposed shape over that seat's real options.
 * `pick` names the answer from the seat's engine-listed actions; `then` lets the engine play on.
 */
function rivalChose(
  store: GameStore,
  decisionPoint: 'encounter' | 'strategy' | 'sell',
  pick: (actions: readonly LegalAction[]) => FakeJevAnswerOptions | 'backup',
  then?: () => void,
): Scene {
  const { enabledActions, observation } = seatDecision(store, 1);
  const picked = pick(enabledActions);
  let wire: OpponentAnswer;
  if (picked === 'backup') {
    wire = { source: 'fallback', fallbackReason: 'timeout', choice: enabledActions[0]!.id };
  } else {
    const fake = fakeJevAnswer(picked);
    wire = {
      source: 'jev',
      ...('choice' in fake ? { choice: fake.choice } : { sellUids: fake.sellUids }),
      detail: readJevDetail(fake),
    };
  }
  const demo = demoChoiceOf({
    answer: wire,
    detail: wire.detail,
    decisionPoint,
    enabledActions,
    observation,
    viewerSeat: 0,
  });
  const before = store.getView()!.feed.length;
  let command: Command;
  if ('sellUids' in wire) {
    command = { actorId: 'player-1', kind: 'sell', payload: { pokemonInstanceIds: wire.sellUids } };
  } else {
    const action = enabledActions.find((entry) => entry.id === wire.choice)!;
    command = { actorId: 'player-1', kind: action.kind, payload: action.payload } as Command;
  }
  const result = store.submit(command);
  if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
  then?.();
  const view = store.getView()!;
  const decision: AiDecision = {
    source: wire.source,
    ...(wire.fallbackReason && { fallbackReason: wire.fallbackReason }),
    ...(demo && { demo }),
  };
  return {
    store,
    view: {
      ...view,
      feed: view.feed.map((entry, index) => (index === before ? { ...entry, decision } : entry)),
    },
  };
}

export function createScenes(fixtures: GalleryFixtures) {
  return {
    /** §4.4: Strategy lists every opponent as a challenge target. */
    challengeChoice: (): Scene => sceneOf(battleStore(fixtures)),

    /** §3.1, §4.4: no battle-ready Pokémon on the other team, so the target is greyed out. */
    challengeBlocked: (): Scene =>
      sceneOf(
        battleStore(fixtures, (state) => {
          for (const member of state.players[1]!.team) member.tired = true;
        }),
      ),

    /** §4.4: the rival holds the turn and challenges the human, who answers. */
    defenderResponse: (): Scene => {
      const store = battleStore(fixtures, (state) => {
        state.activeSeatIndex = 1;
      });
      play(store, { actorId: 'player-1', kind: 'declare_pvp', payload: { targetSeatIndex: 0 } });
      return sceneOf(store);
    },

    /** §4.4: Rival's once-per-Lap forced challenge: nothing to accept, and the reason is shown. */
    forcedChallenge: (): Scene => {
      const store = battleStore(fixtures, (state) => {
        state.activeSeatIndex = 1;
      });
      play(store, {
        actorId: 'player-1',
        kind: 'declare_pvp',
        payload: { targetSeatIndex: 0, force: 'rival' },
      });
      return sceneOf(store);
    },

    /** Appendix C.3: the human's Ability window before the battle roll, with each choice's odds. */
    abilityWindow: (): Scene => {
      const store = battleStore(fixtures, (state) => {
        state.players[0]!.team[0]!.abilityReady = true;
      });
      play(store, { actorId: 'player-0', kind: 'declare_pvp', payload: { targetSeatIndex: 1 } });
      play(store, { actorId: 'player-1', kind: 'respond_pvp', payload: { accept: true } });
      return sceneOf(store);
    },

    /** §4.4, D5: a Gym entry with a battle-ready team. */
    gymEntry: (): Scene => sceneOf(gymStore(fixtures)),

    /** §3.1, D5: a Gym entry with every Pokémon Tired. */
    gymNoBattleReady: (): Scene => sceneOf(gymStore(fixtures, true)),

    /** The same Gym once the engine applied the sole Skip itself. */
    gymNoBattleReadyAuto: (): Scene => {
      const store = gymStore(fixtures, true);
      if (!store.advance({ human: true })) throw new Error('Gallery: the sole Skip did not apply');
      return sceneOf(store);
    },

    /** §4.4, §4.5: the winner's one reward, with a branched evolution on offer. */
    rewardChoice: (): Scene => sceneOf(wonBattle(fixtures)),

    /** The same battle after the winner took the coins: the result stays beside the board. */
    rewardTaken: (): Scene => {
      const store = wonBattle(fixtures);
      const result = store.choose('reward:coins');
      if ('rejected' in result) throw new Error(`Gallery: ${result.reason}`);
      return sceneOf(store);
    },

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
     * §3.1: the Event deck runs out. Seat 0 lands on an Event square twice: the first draw fills
     * the deck, the second finds the draw pile empty and the engine shuffles the discard pile back
     * in. Both draws are real engine records; the view's feed holds them in play order.
     */
    eventAfterReshuffle: (): Scene => {
      const landOnEvent = (drawPile: string[], discardPile: string[]) => {
        const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
          state.phase = { kind: 'resolve' };
          state.players[0]!.routeProgress = 2;
          state.eventDeck = { drawPile, discardPile };
        });
        if (!store.advance({ human: true })) throw new Error('Gallery: the Event did not draw');
        return store;
      };
      const first = landOnEvent([], []);
      const second = landOnEvent(
        [],
        engineContent.events!.map(({ id }) => id),
      );
      const view = second.getView()!;
      return { store: second, view: { ...view, feed: [...first.getView()!.feed, ...view.feed] } };
    },

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

    /** Demo mode: seat 1 threw its Great Ball at a wild Pokémon, and the engine rolled the catch. */
    rivalChoseBall: (): Scene => {
      const store = createFixtureStore(fixtures['encounter-no-ball'], engineContent, (state) => {
        state.activeSeatIndex = 1;
        state.players[1]!.balls = { poke: 3, great: 1, ultra: 0 };
      });
      return rivalChose(
        store,
        'encounter',
        (actions) => {
          const great = actions.find((a) => a.kind === 'catch' && a.payload.ballType === 'great')!;
          const poke = actions.find((a) => a.kind === 'catch' && a.payload.ballType === 'poke')!;
          const release = actions.find((a) => a.kind === 'release')!;
          return {
            questionId: 'encounter',
            confidence: 0.58,
            choice: great.id,
            options: [
              { id: poke.id, probability: 0.25 },
              { id: great.id, probability: 0.65 },
              { id: release.id, probability: 0.1 },
            ],
          };
        },
        () => store.advance({ human: true }),
      );
    },

    /** Demo mode: seat 1 holds two private items at Strategy and chose to use one. */
    rivalChoseItem: (): Scene => {
      const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
        state.activeSeatIndex = 1;
        state.phase = { kind: 'strategy' };
        state.players[1]!.items = ['repel', 'price-shield'].map((itemId, n) => ({
          instanceId: `rival-item-${n}`,
          itemId,
          name: content.items.find((item) => item.id === itemId)!.name,
          visibility: 'secret' as const,
        }));
      });
      return rivalChose(store, 'strategy', (actions) => {
        const [repel, shield, skip] = ['rival-item-0', 'rival-item-1', 'skip'].map((part) =>
          actions.find((a) => a.id.includes(part))!,
        );
        return {
          questionId: 'strategy',
          confidence: 0.41,
          choice: shield!.id,
          options: [
            { id: repel!.id, probability: 0.3 },
            { id: shield!.id, probability: 0.45 },
            { id: skip!.id, probability: 0.25 },
          ],
        };
      });
    },

    /** Demo mode: seat 1 at its Sell Phase with three Pokémon, one chance of selling for each. */
    rivalChoseSale: (): Scene => {
      const store = createFixtureStore(
        fixtures['sell-phase-three-pokemon'],
        engineContent,
        (state) => {
          state.activeSeatIndex = 1;
          const [, second, third] = state.players[0]!.team;
          state.players[1]!.team.push(
            { ...structuredClone(second!), instanceId: 'rival-pokemon-2' },
            { ...structuredClone(third!), instanceId: 'rival-pokemon-3' },
          );
        },
      );
      return rivalChose(store, 'sell', () => ({
        questionId: 'sell',
        confidence: 0.55,
        sellUids: ['rival-pokemon-3'],
        options: [
          { id: 'pokemon-1', probability: 0.2 },
          { id: 'rival-pokemon-2', probability: 0.35 },
          { id: 'rival-pokemon-3', probability: 0.8 },
        ],
      }));
    },

    /** Demo mode: the same encounter, but Jev did not answer in time, so the backup bot decided. */
    rivalBackupAtEncounter: (): Scene => {
      const store = createFixtureStore(fixtures['encounter-no-ball'], engineContent, (state) => {
        state.activeSeatIndex = 1;
      });
      return rivalChose(store, 'encounter', () => 'backup');
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

    /** §4.2, §4.8: the human's Social window, open and unspoken in, against 1 or 2 AI rivals. */
    socialWindowOpen: (rivals: 1 | 2): Scene =>
      sceneOf(
        createFixtureStore(fixtures['shop-low-coins'], engineContent, (state) => {
          openSocialWindow(state);
          if (rivals === 2) addRival(state, 2);
        }),
      ),

    /** The same window after the human sent a truce message to seat 1: its one message is spent. */
    socialMessageSent: (): Scene => {
      const store = createFixtureStore(fixtures['shop-low-coins'], engineContent, openSocialWindow);
      const result = store.choose('chat:seat-1:truce');
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
