import {
  legalActions,
  pendingDecision,
  type EngineDecisionPoint,
  type LegalAction,
} from '../../../engine/index.ts';
import type { MessageKey } from '../i18n/en.ts';
import { classOptions, engineContent } from './content.ts';
import { rollForFirstPlayer } from './firstPlayer.ts';
import { memoryEntries, trustShown } from './promises.ts';
import { completeSetup, type GameSetup } from './setup.ts';
import {
  configForSetup,
  opponentSettings,
  type Command,
  type GameStore,
  type SeatView,
} from './store.ts';

/**
 * Prepared scenarios for demo mode (`?demo`, spec §3, §11 steps 2, 4, 5 and 6, issues #222 and #64).
 *
 * A scene is a seed plus a short script of legal engine actions, applied through the normal store
 * from a fresh game: never a hand-edited state, and no rule lives here. The script only names the
 * choices to make and the dice to apply; the engine accepts or rejects each one. A new engine,
 * content or RNG version rebuilds the scene on the next launch, and a script the engine stops
 * allowing fails to build and says so.
 */
export type DemoStep =
  /** Applies `engine` pending results or sole choices, one engine step each (dice included). */
  | { readonly engine: number }
  /** Seat `seat` takes its enabled legal action with this ID, which must be its pending decision. */
  | { readonly seat: number; readonly choose: string };

export interface DemoScene {
  readonly id: string;
  readonly title: MessageKey;
  readonly description: MessageKey;
  /** Spec §11 steps this scene opens, for the pull request and the test names. */
  readonly demoStep: 2 | 4 | 5 | 6;
  readonly setup: GameSetup;
  readonly seed: number;
  /** Runs after the first-player roll, which every game starts with. */
  readonly script: readonly DemoStep[];
  /** A read-only look at the human seat's view: is the game where the description says it is? */
  readonly atMoment: (view: SeatView) => boolean;
}

const MAIN_CHARACTER = { classId: 'main-character', starterSpeciesId: 'charmander' } as const;
const RIVAL = { classId: 'rival', starterSpeciesId: 'eevee' } as const;

/** The human seat is seat 0 in every scene. */
const HUMAN = 0;

/** Whether the human seat is the one deciding, at this kind of decision point. */
const decidesAt = (view: SeatView, point: EngineDecisionPoint) =>
  view.decision?.seatIndex === view.seatIndex && view.decision.point === point;

export const DEMO_SCENES: readonly DemoScene[] = [
  {
    id: 'ball',
    title: 'demo.scene.ball.title',
    description: 'demo.scene.ball.description',
    demoStep: 2,
    setup: {
      mode: 'quick',
      human: MAIN_CHARACTER,
      opponents: [{ ...RIVAL, personality: 'greedy', difficulty: 'easy' }],
    },
    seed: 3,
    script: [
      { engine: 1 },
      { seat: HUMAN, choose: 'skip' },
      { seat: HUMAN, choose: 'skip' },
      { engine: 3 },
    ],
    atMoment: (view) =>
      decidesAt(view, 'encounter') &&
      view.legalActions.enabled.filter((choice) => choice.kind === 'catch').length >= 2,
  },
  {
    id: 'pvp',
    title: 'demo.scene.pvp.title',
    description: 'demo.scene.pvp.description',
    demoStep: 4,
    setup: {
      mode: 'quick',
      human: RIVAL,
      opponents: [{ ...MAIN_CHARACTER, personality: 'aggressive', difficulty: 'easy' }],
    },
    seed: 1,
    script: [{ engine: 1 }, { seat: HUMAN, choose: 'skip' }],
    atMoment: (view) => {
      const challenges = view.legalActions.enabled.filter(
        (choice) => choice.kind === 'declare_pvp',
      );
      return (
        decidesAt(view, 'strategy') &&
        challenges.some((choice) => choice.payload.force === 'rival') &&
        challenges.some((choice) => choice.payload.force === undefined)
      );
    },
  },
  {
    id: 'reward',
    title: 'demo.scene.reward.title',
    description: 'demo.scene.reward.description',
    demoStep: 5,
    setup: {
      mode: 'quick',
      human: RIVAL,
      opponents: [{ ...MAIN_CHARACTER, personality: 'cautious', difficulty: 'easy' }],
    },
    seed: 4,
    script: [
      { engine: 1 },
      { seat: HUMAN, choose: 'skip' },
      { seat: HUMAN, choose: 'declare-pvp:1' },
      { seat: 1, choose: 'accept-pvp' },
      { seat: HUMAN, choose: 'pass-window' },
      { seat: 1, choose: 'pass-window' },
      { engine: 2 },
    ],
    atMoment: (view) => {
      const rewards = view.legalActions.enabled.filter((choice) => choice.kind === 'choose_reward');
      return (
        decidesAt(view, 'reward') &&
        rewards.some((choice) => choice.payload.kind === 'coins') &&
        rewards.some((choice) => choice.payload.kind === 'evolve')
      );
    },
  },
  {
    id: 'promise',
    title: 'demo.scene.promise.title',
    description: 'demo.scene.promise.description',
    demoStep: 6,
    setup: {
      mode: 'quick',
      human: MAIN_CHARACTER,
      opponents: [{ ...RIVAL, personality: 'aggressive', difficulty: 'easy' }],
    },
    seed: 1,
    script: [
      { engine: 1 },
      // Social: ask the rival to promise not to attack, and the rival accepts (§4.8).
      { seat: HUMAN, choose: 'offer-promise:seat-1:ask' },
      { seat: 1, choose: 'respond:accept' },
      { seat: HUMAN, choose: 'skip' },
      { seat: HUMAN, choose: 'skip' },
      { engine: 3 },
      { seat: HUMAN, choose: 'skip-shop' },
      { engine: 3 },
      // The rival's own turn: it declares a battle on the seat it promised, and the seat declines.
      { seat: 1, choose: 'declare-pvp:0' },
      { seat: HUMAN, choose: 'decline-pvp' },
      { engine: 6 },
    ],
    atMoment: (view) =>
      decidesAt(view, 'turn_step') &&
      view.observation.public.phase.kind === 'social' &&
      memoryEntries(view.observation, view.feed).some(
        (entry) =>
          entry.kind === 'broken' &&
          entry.promiserSeatIndex === 1 &&
          entry.recipientSeatIndex === HUMAN,
      ) &&
      trustShown(view.observation).some((entry) => entry.seatIndex === 1),
  },
];

/**
 * The scenes this build can play: each one's setup must pass the same check the setup screens
 * apply (open classes and personalities, no repeated class). A scene whose prerequisite is not
 * open is not listed, never shown greyed.
 */
export function openScenes(scenes: readonly DemoScene[] = DEMO_SCENES): readonly DemoScene[] {
  return scenes.filter(
    (scene) =>
      completeSetup(
        { mode: scene.setup.mode, human: scene.setup.human, rivals: scene.setup.opponents },
        classOptions,
      ) !== undefined,
  );
}

export function sceneById(id: string | undefined): DemoScene | undefined {
  return openScenes().find((scene) => scene.id === id);
}

/** Why a scene could not be built, for the screen to say in words. */
export type SceneFailure =
  | { readonly kind: 'step'; readonly step: number; readonly total: number }
  | { readonly kind: 'moment' }
  | { readonly kind: 'engine' };

export type SceneBuild =
  { readonly ok: true } | { readonly ok: false; readonly failure: SceneFailure };

/**
 * Who decides now and what the engine allows them, for any seat: a script names a rival's legal
 * action as well as the human's. Private to this file, the one adapter besides the dev gallery's
 * that reads a rival's options (spec §1); nothing else in web/ does. Null while the engine owes a
 * die or the game is over.
 */
function pendingChoices(
  store: GameStore,
): { seatIndex: number; actorId: string; enabled: readonly LegalAction[] } | null {
  const session = store.getSession();
  const pending = session && pendingDecision(session.state);
  if (!session || !pending) return null;
  return {
    seatIndex: pending.seatIndex,
    actorId: pending.actorId,
    enabled: legalActions(session.state, pending.seatIndex).enabled,
  };
}

function applyChoice(store: GameStore, seat: number, id: string): boolean {
  const pending = pendingChoices(store);
  if (pending?.seatIndex !== seat) return false;
  const choice = pending.enabled.find((entry) => entry.id === id);
  if (!choice) return false;
  const result = store.submit({
    actorId: pending.actorId,
    kind: choice.kind,
    payload: choice.payload,
  } as Command);
  return 'accepted' in result;
}

function applyStep(store: GameStore, step: DemoStep): boolean {
  if ('engine' in step) {
    for (let done = 0; done < step.engine; done++) {
      if (!store.advance({ human: true })) return false;
    }
    return true;
  }
  return applyChoice(store, step.seat, step.choose);
}

/**
 * Starts the scene's game in `store` and plays its script. On any failure the store is cleared:
 * a scene that cannot be built leaves no game and no save behind, never a half-built one.
 */
export function buildScene(store: GameStore, scene: DemoScene): SceneBuild {
  const fail = (failure: SceneFailure): SceneBuild => {
    store.clear();
    return { ok: false, failure };
  };
  try {
    store.start(
      configForSetup(scene.setup, scene.seed),
      engineContent,
      opponentSettings(scene.setup),
      undefined,
      scene.id,
    );
    rollForFirstPlayer(store);
    for (const [index, step] of scene.script.entries()) {
      if (!applyStep(store, step)) {
        return fail({ kind: 'step', step: index + 1, total: scene.script.length });
      }
    }
    const view = store.getView();
    if (!view || !scene.atMoment(view)) return fail({ kind: 'moment' });
    return { ok: true };
  } catch {
    // The engine's own text is not for the player; the failure says only that the build stopped.
    return fail({ kind: 'engine' });
  }
}
