import fc from 'fast-check';
import { expect, test } from 'vitest';
import { replay, stateHash } from '../engine/index.ts';
import { realEngine } from './engine.ts';
import { gamePlan, playGame, PROPERTY_TIMEOUT_MS, PROPERTY_RUNS, sameJson } from './legal-games.ts';

test(
  'replaying the command log of 200 random legal games reproduces the live final state (§6.8, §8)',
  () =>
    fc.assert(
      fc.property(gamePlan(realEngine.classIds), (plan) => {
        playGame(realEngine, plan, {
          afterStep: ({ action, result }) => {
            // Each record must hold exactly what was submitted and emitted, as replay re-runs it.
            if (
              'accepted' in result &&
              (!sameJson(result.record.action, action) ||
                !sameJson(result.record.events, result.events))
            ) {
              throw new Error('the logged record differs from the submitted action or its events');
            }
          },
          afterGame: (game) => expect(stateHash(replay(game.log))).toBe(stateHash(game.state)),
        });
      }),
      PROPERTY_RUNS,
    ),
  PROPERTY_TIMEOUT_MS,
);
