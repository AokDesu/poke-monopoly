import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  applyAction,
  createGame,
  createGameConfig,
  legalActions,
  observe,
  type GameState,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { ChoicePanel } from './ChoicePanel.tsx';

/** The human (seat 0) resolves the Gym at square 6 and owns the entry choice (#55 S09). */
function gymEntry(): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'researcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        starterSpeciesId: classId === 'main-character' ? 'bulbasaur' : undefined,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 2,
      lapTarget: 2,
    }),
    engineContent,
  );
  state.phase = { kind: 'resolve' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.players[0]!.routeProgress = 6;
  const result = applyAction(state, {
    actorId: 'p0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'skip',
    payload: {},
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

test('a Gym entry lists the engine’s challenge and skip choices in plain words, and choosing submits that ID', () => {
  const state = gymEntry();
  const chosen: string[] = [];
  render(
    <ChoicePanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={(id) => chosen.push(id)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('choice.challengeGym') }));
  fireEvent.click(screen.getByRole('button', { name: t('choice.skipGym') }));
  expect(chosen).toEqual(['challenge-gym', 'skip']);
});
