import { useState } from 'react';
import type { LegalActions, Observation } from '../../../engine/index.ts';
import type { ChallengeOdds } from '../game/store.ts';
import { content, itemStatus } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { itemName, memberName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { AbilityPanel } from './AbilityPanel.tsx';
import { ChallengePanel } from './ChallengePanel.tsx';
import { DecisionCard, Folded, foldLabel, useInView } from './DecisionCard.tsx';
import { ItemFacts } from './ItemFacts.tsx';
import { phaseLabel, seatLabel } from './labels.ts';

/**
 * Strategy (spec §4.2) in the decision slot: the items, Abilities and challenges the player can use
 * now first, each kind's greyed-out ones folded into one line that opens to the engine's reasons,
 * and Skip in the footer. Choosing previews; only Confirm spends anything.
 */
export function StrategyPanel({
  observation,
  legalActions,
  challenges = [],
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  /** The engine's odds for each challenge this seat could declare. */
  challenges?: readonly ChallengeOdds[];
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
  const preview = useInView<HTMLElement>(choice?.id);
  const choicesOf = (instanceId: string) =>
    options.filter(
      (action) => action.kind === 'use_item' && action.payload.itemInstanceId === instanceId,
    );
  const usable = observation.own.items.filter((owned) =>
    choicesOf(owned.instanceId).some((action) => legalActions.enabled.includes(action)),
  );
  const closed = observation.own.items.filter((owned) => !usable.includes(owned));
  const itemRow = (owned: (typeof observation.own.items)[number]) => {
    const choices = choicesOf(owned.instanceId);
    if (choices.length === 0) {
      // No engine choice: either the effect is not implemented, or no target exists. The
      // greyed-out reason then says so, so the card does not repeat it.
      const planned = itemStatus(owned.itemId) === 'planned';
      return (
        <li key={owned.instanceId}>
          <ActionButton
            enabled={false}
            reasonText={t(planned ? 'item.status.planned' : 'action.reason.NO_VALID_TARGET')}
            variant="secondary"
          >
            {itemName(owned.itemId)}
          </ActionButton>
          <ItemFacts itemId={owned.itemId} showStatus={!planned} />
        </li>
      );
    }
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
        <ItemFacts itemId={owned.itemId} />
      </li>
    );
  };
  return (
    <DecisionCard
      kind="strategy"
      heading={phaseLabel('strategy')}
      lead={t('turn.strategyBody')}
      actions={
        skip && (
          <ActionButton
            enabled
            variant="secondary"
            data-primary=""
            onClick={() => onChoose(skip.id)}
          >
            {t('strategy.skip')}
          </ActionButton>
        )
      }
    >
      <section className="card-section" aria-label={t('board.items')}>
        <h3>{t('board.items')}</h3>
        {observation.own.items.length === 0 && <p className="card-copy">{t('board.emptyItems')}</p>}
        {selection?.potion && !currentSelection && (
          <p role="alert">{t('strategy.potion.staleSelection')}</p>
        )}
        {usable.length > 0 && <ul className="strategy-items">{usable.map(itemRow)}</ul>}
        {closed.length > 0 && (
          <Folded label={foldLabel(closed.length, 'items')}>
            <ul className="strategy-items">{closed.map(itemRow)}</ul>
          </Folded>
        )}
        {item && (
          <>
            {selected.some(
              (action) =>
                action.kind === 'use_item' && action.payload.targetSeatIndex !== undefined,
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
                        pokemon: memberName(ownTeam, pokemon.instanceId),
                      })}
                    </ActionButton>
                  );
                })}
              </div>
            )}
            {choice && definition?.kind === 'utility' ? (
              <section
                ref={preview}
                className="item-preview"
                aria-label={t('strategy.preview')}
                aria-live="polite"
              >
                <h3>{t('strategy.preview')}</h3>
                <p>
                  {choice.kind === 'use_item' && choice.payload.status === 'tired'
                    ? t('strategy.potion.effect')
                    : t('strategy.effect', { effect: definition.effect })}
                </p>
                <p>
                  {targetPokemon
                    ? t('strategy.potion.target', {
                        pokemon: memberName(ownTeam, targetPokemon.instanceId),
                      })
                    : t('strategy.target', { target: seatLabel(targetSeat ?? ownSeat, ownSeat) })}
                </p>
                {target && <p>{t('strategy.targetCoins', { coins: target.coins })}</p>}
                <p className="panel-note">{t('strategy.cost')}</p>
                <ActionButton enabled data-primary="" onClick={() => onChoose(choice.id)}>
                  {t('strategy.confirm', { item: itemName(item.itemId) })}
                </ActionButton>
              </section>
            ) : (
              <p className="target-prompt" role="status">
                {t(
                  item.itemId === 'potion'
                    ? 'strategy.potion.chooseTarget'
                    : 'strategy.chooseTarget',
                )}
              </p>
            )}
          </>
        )}
      </section>
      <AbilityPanel observation={observation} legalActions={legalActions} onChoose={onChoose} />
      <ChallengePanel
        observation={observation}
        legalActions={legalActions}
        challenges={challenges}
        onChoose={onChoose}
      />
    </DecisionCard>
  );
}
