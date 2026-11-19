import { engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  opponentSettings,
  type GameStore,
} from '../game/store.ts';

/** A one-human quick game against one rival, for the "What Jev chose" panel's tests (issue #220). */
const setup = {
  mode: 'quick',
  human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  opponents: [
    {
      classId: 'researcher',
      starterSpeciesId: 'porygon',
      personality: 'greedy',
      difficulty: 'normal',
    },
  ],
} as const;

/** `demo` is the store's own gate: whether demo mode is open when a rival decides. */
export function demoGame(demo: () => boolean = () => false): GameStore {
  const store = createGameStore({ demo });
  const opponents = [...setup.opponents];
  store.start(
    { ...configForSetup({ ...setup, opponents }, 1), lapTarget: 1 },
    engineContent,
    opponentSettings({ ...setup, opponents }),
  );
  return store;
}

function pass(store: GameStore) {
  if (store.getView()!.legalActions.enabled.length <= 1) return;
  const choice = store
    .getView()!
    .legalActions.enabled.find(
      (entry) =>
        ['skip', 'release', 'skip_shop'].includes(entry.kind) || entry.id === 'finish-sell',
    );
  if (choice) store.choose(choice.id);
}

/** Plays the human's turn out until a rival has a decision waiting. */
export function seekOpponent(store: GameStore) {
  for (let i = 0; i < 300; i++) {
    if (store.advance({ human: true })) continue;
    if (store.getView()!.observation.public.activeSeatIndex !== 0) return;
    pass(store);
  }
  throw new Error('No opponent decision');
}
