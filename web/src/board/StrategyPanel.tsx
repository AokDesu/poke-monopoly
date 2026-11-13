import { useState } from 'react';
import type { LegalActions, Observation } from '../../../engine/index.ts';
import { content } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { seatLabel } from './labels.ts';

export function StrategyPanel({
  observation,
  legalActions,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  onChoose: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{
    actions: LegalActions;
    itemId: string;
    choiceId?: string;
    potion: boolean;
  }>();
  // A preview belongs to one offered action list, never to a later revision.
  const currentSelection = selection?.actions === legalActions ? selection : undefined;
  const itemId = currentSelection?.itemId;
  const choiceId = currentSelection?.choiceId;
  const ownSeat = observation.own.seatIndex;
  // Both enabled and disabled options are engine-owned; never invent hostile targets.
  const options = [...legalActions.enabled, ...legalActions.disabled].filter(
    (action) => action.kind === 'use_item' && action.payload.targetSeatIndex !== ownSeat,
  );
  const selected = options.filter(
    (action) => action.kind === 'use_item' && action.payload.itemInstanceId === itemId,
  );
  const choice = legalActions.enabled.find(
    (action) => action.id === choiceId && selected.includes(action),
  );
  const item = observation.own.items.find((owned) => owned.instanceId === itemId);
  const definition = content.items.find((entry) => entry.id === item?.itemId);
  const targetSeat = choice?.kind === 'use_item' ? choice.payload.targetSeatIndex : undefined;
  const target = observation.public.players.find((player) => player.seatIndex === targetSeat);
  const ownTeam = observation.public.players.find((player) => player.seatIndex === ownSeat)!.team;
  const targetPokemon =
    choice?.kind === 'use_item'
      ? ownTeam.find((pokemon) => pokemon.instanceId === choice.payload.targetPokemonInstanceId)
      : undefined;
  const skip = legalActions.enabled.find((action) => action.kind === 'skip');
  return (
    <div className="decision-panel strategy-panel">
      {observation.own.items.length === 0 && <p>{t('board.emptyItems')}</p>}
      {selection?.potion && !currentSelection && (
        <p role="alert">{t('strategy.potion.staleSelection')}</p>
      )}
      <ul className="strategy-items">
        {observation.own.items.map((owned) => {
          const choices = options.filter(
            (action) =>
              action.kind === 'use_item' && action.payload.itemInstanceId === owned.instanceId,
          );
          if (choices.length === 0) return null;
          const enabled = choices.find((action) => !('reasonText' in action));
          const disabled = legalActions.disabled.find((action) =>
            choices.some((choice) => choice.id === action.id),
          )!;
          const availability = enabled
            ? { enabled: true as const }
            : {
                enabled: false as const,
                reasonText: t('action.engineReason', { reason: disabled.reasonText }),
              };
          return (
            <li key={owned.instanceId}>
              <ActionButton
                {...availability}
                variant={itemId === owned.instanceId ? 'reward' : 'secondary'}
                aria-pressed={itemId === owned.instanceId}
                onClick={() => {
                  setSelection({
                    actions: legalActions,
                    itemId: owned.instanceId,
                    potion: owned.itemId === 'potion',
                    // Only targetless self-use may preselect a confirmation.
                    choiceId:
                      enabled?.kind === 'use_item' &&
                      enabled.payload.targetSeatIndex === undefined &&
                      enabled.payload.targetPokemonInstanceId === undefined
                        ? enabled.id
                        : undefined,
                  });
                }}
              >
                {itemName(owned.itemId)}
              </ActionButton>
            </li>
          );
        })}
      </ul>
      {item && (
        <>
          {selected.some(
            (action) => action.kind === 'use_item' && action.payload.targetSeatIndex !== undefined,
          ) && (
            <div className="item-targets" role="group" aria-label={t('strategy.targets')}>
              <h3>{t('strategy.targets')}</h3>
              {selected.map((action) => {
                if (action.kind !== 'use_item' || action.payload.targetSeatIndex === undefined)
                  return null;
                const disabled = legalActions.disabled.find((entry) => entry.id === action.id);
                const availability = disabled
                  ? {
                      enabled: false as const,
                      reasonText: t('action.engineReason', { reason: disabled.reasonText }),
                    }
                  : { enabled: true as const };
                return (
                  <ActionButton
                    key={action.id}
                    {...availability}
                    variant="secondary"
                    aria-pressed={choiceId === action.id}
                    onClick={() => setSelection({ ...currentSelection!, choiceId: action.id })}
                  >
                    {seatLabel(action.payload.targetSeatIndex, ownSeat)}
                  </ActionButton>
                );
              })}
            </div>
          )}
          {selected.some(
            (action) =>
              action.kind === 'use_item' && action.payload.targetPokemonInstanceId !== undefined,
          ) && (
            <div className="item-targets" role="group" aria-label={t('strategy.potion.targets')}>
              <h3>{t('strategy.potion.targets')}</h3>
              {selected.map((action) => {
                if (
                  action.kind !== 'use_item' ||
                  action.payload.targetPokemonInstanceId === undefined
                )
                  return null;
                const pokemon = ownTeam.find(
                  (entry) => entry.instanceId === action.payload.targetPokemonInstanceId,
                );
                if (!pokemon) return null;
                const disabled = legalActions.disabled.find((entry) => entry.id === action.id);
                const availability = disabled
                  ? {
                      enabled: false as const,
                      reasonText: t('action.engineReason', { reason: disabled.reasonText }),
                    }
                  : { enabled: true as const };
                return (
                  <ActionButton
                    key={action.id}
                    {...availability}
                    variant="secondary"
                    aria-pressed={choiceId === action.id}
                    onClick={() => setSelection({ ...currentSelection!, choiceId: action.id })}
                  >
                    {t('strategy.potion.member', {
                      pokemon: speciesName(pokemon.speciesId),
                      instanceId: pokemon.instanceId,
                    })}
                  </ActionButton>
                );
              })}
            </div>
          )}
          {choice && definition?.kind === 'utility' ? (
            <section className="item-preview" aria-label={t('strategy.preview')} aria-live="polite">
              <h3>{t('strategy.preview')}</h3>
              <p>
                {choice.kind === 'use_item' && choice.payload.status === 'tired'
                  ? t('strategy.potion.effect')
                  : t('strategy.effect', { effect: definition.effect })}
              </p>
              <p>
                {targetPokemon
                  ? t('strategy.potion.target', {
                      pokemon: speciesName(targetPokemon.speciesId),
                      instanceId: targetPokemon.instanceId,
                    })
                  : t('strategy.target', { target: seatLabel(targetSeat ?? ownSeat, ownSeat) })}
              </p>
              {target && <p>{t('strategy.targetCoins', { coins: target.coins })}</p>}
              <p className="panel-note">{t('strategy.cost')}</p>
              <ActionButton enabled onClick={() => onChoose(choice.id)}>
                {t('strategy.confirm', { item: itemName(item.itemId) })}
              </ActionButton>
            </section>
          ) : (
            <p className="target-prompt" role="status">
              {t(
                item.itemId === 'potion' ? 'strategy.potion.chooseTarget' : 'strategy.chooseTarget',
              )}
            </p>
          )}
        </>
      )}
      {skip && (
        <ActionButton enabled variant="secondary" onClick={() => onChoose(skip.id)}>
          {t('strategy.skip')}
        </ActionButton>
      )}
    </div>
  );
}
