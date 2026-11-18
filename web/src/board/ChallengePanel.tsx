import { useState } from 'react';
import type { LegalAction, LegalActions, Observation } from '../../../engine/index.ts';
import type { ChallengeOdds } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { BattleTerms } from './BattleTerms.tsx';
import { seatLabel } from './labels.ts';

type Declare = Extract<LegalAction, { kind: 'declare_pvp' }>;

/**
 * Strategy's PvP controls (spec §4.4): one voluntary challenge per opponent, plus Rival's forced
 * challenge when the engine offers it. Every target, and the reason a control is greyed out, is
 * the engine's own list. Choosing a target only previews it; the tactical action is spent on Confirm.
 */
export function ChallengePanel({
  observation,
  legalActions,
  challenges,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  challenges: readonly ChallengeOdds[];
  onChoose: (id: string) => void;
}) {
  const [picked, setPicked] = useState<{ actions: LegalActions; id: string }>();
  const own = observation.own.seatIndex;
  const options = [
    ...legalActions.enabled.map((action) => ({ action, reason: undefined })),
    ...legalActions.disabled.map((action) => ({ action, reason: action.reasonText })),
  ].flatMap(({ action, reason }) => (action.kind === 'declare_pvp' ? [{ action, reason }] : []));
  if (options.length === 0) return null;
  // A preview belongs to one offered action list, never to a later revision.
  const current = picked?.actions === legalActions ? picked.id : undefined;
  const chosen = legalActions.enabled.find(
    (action): action is Declare => action.kind === 'declare_pvp' && action.id === current,
  );
  const targets = [...new Set(options.map(({ action }) => action.payload.targetSeatIndex))];
  const terms =
    chosen && challenges.find((entry) => entry.seatIndex === chosen.payload.targetSeatIndex);
  const target =
    chosen &&
    observation.public.players.find((p) => p.seatIndex === chosen.payload.targetSeatIndex);
  return (
    <section className="challenge-panel" aria-labelledby="challenge-heading">
      <h3 id="challenge-heading">{t('challenge.heading')}</h3>
      <p className="panel-note">{t('challenge.intro')}</p>
      {picked && !current && (
        <p role="alert" className="battle-stale">
          {t('challenge.stale')}
        </p>
      )}
      <ul className="challenge-targets">
        {targets.map((seatIndex) => {
          const player = observation.public.players.find((entry) => entry.seatIndex === seatIndex);
          return (
            <li key={seatIndex}>
              <p className="challenge-target">
                <strong>{seatLabel(seatIndex, own)}</strong>
                {player && (
                  <span>
                    {t('challenge.targetFacts', {
                      class: className(player.classId),
                      coins: player.coins,
                    })}
                  </span>
                )}
              </p>
              <div className="challenge-actions">
                {options
                  .filter(({ action }) => action.payload.targetSeatIndex === seatIndex)
                  .map(({ action, reason }) => {
                    const forced = action.payload.force === 'rival';
                    const label = t(forced ? 'challenge.force' : 'challenge.voluntary', {
                      name: seatLabel(seatIndex, own),
                    });
                    return reason !== undefined ? (
                      <ActionButton
                        key={action.id}
                        enabled={false}
                        variant="secondary"
                        reasonText={t('action.engineReason', { reason })}
                      >
                        {label}
                      </ActionButton>
                    ) : (
                      <ActionButton
                        key={action.id}
                        enabled
                        variant={current === action.id ? 'reward' : 'secondary'}
                        aria-pressed={current === action.id}
                        onClick={() => setPicked({ actions: legalActions, id: action.id })}
                      >
                        {label}
                      </ActionButton>
                    );
                  })}
              </div>
            </li>
          );
        })}
      </ul>
      {chosen && target && (
        <section className="item-preview" aria-label={t('challenge.preview')} aria-live="polite">
          <h3>{t('challenge.preview')}</h3>
          <p>
            {t(
              chosen.payload.force === 'rival' ? 'challenge.forcedNote' : 'challenge.voluntaryNote',
              {
                name: seatLabel(target.seatIndex, own),
              },
            )}
          </p>
          {terms && <BattleTerms terms={terms} viewerSeat={own} frozen={false} />}
          <p className="panel-note">{t('challenge.cost')}</p>
          <ActionButton enabled onClick={() => onChoose(chosen.id)}>
            {t('challenge.confirm', { name: seatLabel(target.seatIndex, own) })}
          </ActionButton>
        </section>
      )}
    </section>
  );
}
