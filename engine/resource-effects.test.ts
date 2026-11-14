/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  eventsVisibleTo,
  legalActions,
  observe,
  pendingDecision,
  replay,
  type Action,
  type ActionRecord,
  type Content,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** C4 content decides who carries `track`; this scenario binds it to Growlithe (§4.5 peek). */
function withTrack(): Content {
  const bound = structuredClone(content);
  bound.species.find((entry) => entry.id === 'growlithe')!.ability!.effect = 'track';
  return bound;
}

/** Seat 0 Fisherman (Magikarp) is in Strategy; the log starts at revision 0 (§6.8). */
function game(seed: number, engineContent = content): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', 'researcher', 'bug-catcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed,
      lapTarget: 2,
    }),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 5;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 2;
  return state;
}

function seedFor(face: (value: number) => boolean): number {
  for (let seed = 0; ; seed++) if (face(d6(createRng(seed), 'x').value)) return seed;
}

function step(state: GameState, kind: Action['kind'], payload: unknown = {}) {
  const action = {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action;
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result;
}

test.each([
  [5, 1],
  [6, 1],
  [4, 0],
  [1, 0],
])(
  'Lucky Splash rolls a logged d6: %i gains %i Great Ball, told only to its owner; the costs stay spent (C.1 chanceBall, D10)',
  (face, gained) => {
    const state = game(seedFor((value) => value === face));
    const activated = step(state, 'activate_ability', { instanceId: 'starter:0' });
    expect(activated.state.phase.kind).toBe('chance_roll');
    expect(pendingDecision(activated.state)).toBeNull();
    const rolled = advanceAutomatically(activated.state);
    const after = rolled.state;
    expect(after.phase.kind).toBe('strategy');
    expect(after.players[0]!.balls).toEqual({ poke: 5, great: 1 + gained, ultra: 0 });
    expect(after.players[0]!.abilityUsedGlobalTurnNo).toBe(5);
    expect(after.players[0]!.team[0]!.abilityReady).toBe(false);
    const ownKinds = eventsVisibleTo(activated.state, rolled.events, 0).map((event) => event.kind);
    const otherKinds = eventsVisibleTo(activated.state, rolled.events, 1).map(
      (event) => event.kind,
    );
    expect(ownKinds.includes('ball_gained')).toBe(gained === 1);
    expect(otherKinds).not.toContain('ball_gained');
    // The same Lap and globalTurnNo offer no second activation.
    expect(legalActions(after, 0).enabled.map((choice) => choice.id)).not.toContain(
      'ability:starter:0',
    );
  },
);

test('Track peeks the top Event card privately: a logged first shuffle fills the deck, nothing is drawn or reordered, and other seats see no card or order (§4.5 peek, §5.4)', () => {
  const initial = game(3, withTrack());
  initial.players[0]!.team = [{ ...initial.players[0]!.team[0]!, speciesId: 'growlithe' }];
  expect(initial.eventDeck).toEqual({ drawPile: [], discardPile: [] });
  expect(initial.rng.cursor).toBe(0); // setup draws no RNG (§6.8)
  const log = createGameLog(structuredClone(initial));
  const peeked = step(initial, 'activate_ability', { instanceId: 'starter:0' });
  log.actions.push(peeked.record);
  const after = peeked.state;
  expect([...after.eventDeck.drawPile].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  const top = after.eventDeck.drawPile[0]!;
  expect(after.players[0]!.privateResults).toEqual([{ kind: 'peek', eventId: top }]);
  expect(observe(after, 0).own.privateResults).toEqual([{ kind: 'peek', eventId: top }]);
  for (const seat of [1, 2]) {
    const seen = JSON.stringify([
      observe(after, seat),
      legalActions(after, seat),
      actionVisibleTo(initial, peeked.record as ActionRecord, seat),
    ]);
    for (const card of after.eventDeck.drawPile) expect(seen).not.toContain(`"${card}"`);
  }
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(after);

  // A later peek on a new Lap sees the same top card: peeking never draws or reorders.
  const later = structuredClone(after);
  later.globalTurnNo = 8;
  later.turnBudgets.pokemonAbility = 1;
  later.players[0]!.team[0]!.abilityReady = true;
  const again = step(later, 'activate_ability', { instanceId: 'starter:0' }).state;
  expect(again.eventDeck).toEqual(after.eventDeck);
  expect(again.players[0]!.privateResults.at(-1)).toEqual({ kind: 'peek', eventId: top });
});

test('an empty draw pile reshuffles the discard pile before a peek (§3.1, §4.6)', () => {
  const state = game(3, withTrack());
  state.players[0]!.team = [{ ...state.players[0]!.team[0]!, speciesId: 'growlithe' }];
  state.eventDeck = { drawPile: [], discardPile: ['e2', 'e5'] };
  const after = step(state, 'activate_ability', { instanceId: 'starter:0' }).state;
  expect([...after.eventDeck.drawPile].sort()).toEqual(['e2', 'e5']);
  expect(after.eventDeck.discardPile).toEqual([]);
});
